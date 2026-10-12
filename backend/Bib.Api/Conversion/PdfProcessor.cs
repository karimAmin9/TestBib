using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.RegularExpressions;
using UglyToad.PdfPig;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.DocumentLayoutAnalysis;
using UglyToad.PdfPig.DocumentLayoutAnalysis.PageSegmenter;
using UglyToad.PdfPig.DocumentLayoutAnalysis.ReadingOrderDetector;
using UglyToad.PdfPig.DocumentLayoutAnalysis.WordExtractor;
using UglyToad.PdfPig.Exceptions;

namespace Bib.Api.Conversion;

/// <summary>
/// Converts a PDF into chapters (one per page) of paragraphs and images.
/// Everything it intentionally drops is recorded as a <see cref="Removal"/> so the
/// <see cref="ConversionVerifier"/> can prove nothing else was lost.
/// </summary>
public sealed partial class PdfProcessor(IPageRenderer renderer)
{
    /// <summary>Scale used when an image has to be rendered from the page (2.0 = 144 dpi).</summary>
    public const double FallbackRenderScale = 2.0;

    public const int CoverWidth = 360;

    /// <summary>Upper bound for untrusted input; protects the worker from pathological files.</summary>
    public const int MaxPages = 5000;

    /// <summary>Fraction of the page height at top and bottom where page numbers are expected.</summary>
    private const double MarginFraction = 0.1;

    public static string ImageFileName(int page, int index, string extension) => $"p{page}-{index}.{extension}";

    public static string PageImageFileName(int page) => $"p{page}-page.png";

    public static string ChapterTitle(int page) => $"Page {page}";

    public ProcessedBook Process(byte[] pdf, string imageDir, string fallbackTitle)
    {
        Directory.CreateDirectory(imageDir);

        using var doc = Open(pdf);
        if (doc.NumberOfPages > MaxPages)
        {
            throw new PdfProcessingException($"This PDF has {doc.NumberOfPages} pages; the maximum is {MaxPages}.");
        }

        var chapters = new List<ProcessedChapter>(doc.NumberOfPages);
        for (var n = 1; n <= doc.NumberOfPages; n++)
        {
            chapters.Add(ProcessPage(pdf, doc.GetPage(n), imageDir));
        }

        var (title, author) = ReadMetadata(doc, fallbackTitle);
        return new ProcessedBook(title, author, doc.NumberOfPages, chapters, TryRenderCover(pdf, doc));
    }

    public static PdfDocument Open(byte[] pdf)
    {
        try
        {
            return PdfDocument.Open(pdf);
        }
        catch (PdfDocumentEncryptedException ex)
        {
            throw new PdfProcessingException("This PDF is password protected and cannot be converted.", ex);
        }
        catch (Exception ex)
        {
            throw new PdfProcessingException("The file could not be read as a PDF. It may be damaged.", ex);
        }
    }

    private ProcessedChapter ProcessPage(byte[] pdf, Page page, string imageDir)
    {
        var removed = new List<Removal>();
        var textBlocks = ExtractTextBlocks(page, removed);
        var images = ExtractImages(pdf, page, imageDir);

        // Merge images into the reading order by vertical position (PDF y grows upwards).
        var blocks = new List<ContentBlock>(textBlocks.Count + images.Count);
        var pending = new Queue<(double Top, ContentBlock Block)>(
            images.OrderByDescending(i => i.Top).ThenBy(i => i.Left).Select(i => (i.Top, i.Block)));
        foreach (var (top, block) in textBlocks)
        {
            while (pending.Count > 0 && pending.Peek().Top > top)
            {
                blocks.Add(pending.Dequeue().Block);
            }

            blocks.Add(block);
        }

        blocks.AddRange(pending.Select(p => p.Block));

        if (blocks.Count == 0 && page.Letters.Count == 0 && page.Paths.Count > 0)
        {
            // Vector-only page (drawing, chart): keep it as a rendered image.
            blocks.Add(RenderToFile(pdf, page, null, imageDir, PageImageFileName(page.Number)));
        }

        return new ProcessedChapter(page.Number, blocks, removed);
    }

    private static List<(double Top, ContentBlock Block)> ExtractTextBlocks(Page page, List<Removal> removed)
    {
        var words = page.GetWords(NearestNeighbourWordExtractor.Instance)
            .Where(w => !string.IsNullOrWhiteSpace(w.Text))
            .ToList();
        var result = new List<(double Top, ContentBlock Block)>();
        if (words.Count == 0)
        {
            return result;
        }

        var segmented = DocstrumBoundingBoxes.Instance.GetBlocks(words);
        var ordered = UnsupervisedReadingOrderDetector.Instance.Get(segmented).ToList();

        // Safety net: never lose a word the segmenter did not assign to a block.
        var used = new HashSet<Word>(ReferenceEqualityComparer.Instance);
        foreach (var block in ordered)
        {
            foreach (var line in block.TextLines)
            {
                used.UnionWith(line.Words);
            }
        }

        var orphans = words.Where(w => !used.Contains(w)).ToList();

        var bodySize = DominantFontSize(words);
        foreach (var paragraph in MergeContinuations(ordered).SelectMany(SplitParagraphs))
        {
            var lines = paragraph.Select(l => string.Join(' ', l.Words.Select(w => w.Text.Trim()))).ToList();
            var blockRemovals = new List<Removal>();
            var text = JoinLines(lines, blockRemovals);
            if (string.IsNullOrWhiteSpace(text))
            {
                continue;
            }

            var box = new PdfRectangle(
                paragraph.Min(l => l.BoundingBox.Left),
                paragraph.Min(l => l.BoundingBox.Bottom),
                paragraph.Max(l => l.BoundingBox.Right),
                paragraph.Max(l => l.BoundingBox.Top));
            if (IsInMargin(box, page) && TextNormalizer.LooksLikePageNumber(text))
            {
                removed.Add(new Removal(RemovalKinds.PageNumber, text));
                continue;
            }

            removed.AddRange(blockRemovals);
            result.Add((box.Top, IsHeading(paragraph, bodySize) ? ContentBlock.Heading(text) : ContentBlock.Paragraph(text)));
        }

        if (orphans.Count > 0)
        {
            var orphanText = string.Join(' ', orphans.Select(w => w.Text.Trim()));
            result.Add((orphans.Min(w => w.BoundingBox.Top), ContentBlock.Paragraph(orphanText)));
        }

        return result;
    }

    /// <summary>
    /// The segmenter estimates line spacing for the whole page, so lines in a larger font
    /// (a wrapped heading) can end up in separate blocks. Re-joins consecutive blocks whose
    /// lines continue each other: same font size, normal line pitch, overlapping horizontally.
    /// </summary>
    private static List<IReadOnlyList<TextLine>> MergeContinuations(IReadOnlyList<TextBlock> ordered)
    {
        var result = new List<IReadOnlyList<TextLine>>();
        List<TextLine>? current = null;
        foreach (var block in ordered)
        {
            if (current is not null && Continues(current[^1], block.TextLines[0]))
            {
                current.AddRange(block.TextLines);
                continue;
            }

            current = [.. block.TextLines];
            result.Add(current);
        }

        return result;
    }

    private static bool Continues(TextLine previous, TextLine next)
    {
        var size = FontSize(previous);
        if (Math.Abs(size - FontSize(next)) > 0.5)
        {
            return false;
        }

        var pitch = previous.BoundingBox.Bottom - next.BoundingBox.Bottom;
        var overlap = Math.Min(previous.BoundingBox.Right, next.BoundingBox.Right) -
                      Math.Max(previous.BoundingBox.Left, next.BoundingBox.Left);
        return pitch > 0 && pitch <= 1.7 * size && overlap > 0;
    }

    /// <summary>
    /// Splits a layout block into paragraphs where the vertical gap between two lines is clearly
    /// larger than normal line spacing (blank line, or text interrupted by an image).
    /// </summary>
    private static IEnumerable<IReadOnlyList<TextLine>> SplitParagraphs(IReadOnlyList<TextLine> lines)
    {
        if (lines.Count <= 1)
        {
            yield return lines;
            yield break;
        }

        var pitches = new List<double>(lines.Count - 1);
        for (var i = 1; i < lines.Count; i++)
        {
            pitches.Add(lines[i - 1].BoundingBox.Bottom - lines[i].BoundingBox.Bottom);
        }

        var sorted = pitches.Order().ToList();
        var median = sorted[sorted.Count / 2];

        var current = new List<TextLine> { lines[0] };
        for (var i = 1; i < lines.Count; i++)
        {
            var pitch = pitches[i - 1];
            var fontSize = Math.Max(FontSize(lines[i - 1]), FontSize(lines[i]));
            var isBreak = pitch > 2.0 * fontSize || (pitches.Count >= 2 && pitch > 1.6 * median);
            if (isBreak)
            {
                yield return current;
                current = [];
            }

            current.Add(lines[i]);
        }

        yield return current;
    }

    /// <summary>The font size used by most letters on the page (the body text).</summary>
    private static double DominantFontSize(IEnumerable<Word> words) =>
        words.SelectMany(w => w.Letters)
            .GroupBy(l => Math.Round(l.PointSize * 2) / 2)
            .MaxBy(g => g.Count())?.Key ?? 0;

    /// <summary>Short blocks set clearly larger than the body text, e.g. "Chapter One".</summary>
    private static bool IsHeading(IReadOnlyList<TextLine> lines, double bodySize) =>
        bodySize > 0 && lines.Count <= 3 && lines.Min(FontSize) >= bodySize * 1.25;

    private static double FontSize(TextLine line) =>
        line.Words.SelectMany(w => w.Letters).Select(l => l.PointSize).DefaultIfEmpty(line.BoundingBox.Height).Max();

    /// <summary>Joins the lines of a block, repairing words split by a hyphen at the line end.</summary>
    public static string JoinLines(IReadOnlyList<string> lines, List<Removal> removed)
    {
        var sb = new StringBuilder();
        foreach (var raw in lines)
        {
            var line = raw.Trim();
            if (line.Length == 0)
            {
                continue;
            }

            if (sb.Length == 0)
            {
                sb.Append(line);
            }
            else if (TextNormalizer.IsHyphenBreak(sb.ToString(), line))
            {
                removed.Add(new Removal(RemovalKinds.Hyphen, sb[^1].ToString()));
                sb.Length--;
                sb.Append(line);
            }
            else
            {
                sb.Append(' ').Append(line);
            }
        }

        return sb.ToString();
    }

    private static bool IsInMargin(PdfRectangle box, Page page)
    {
        var margin = page.Height * MarginFraction;
        return box.Bottom >= page.Height - margin || box.Top <= margin;
    }

    private List<(double Top, double Left, ContentBlock Block)> ExtractImages(byte[] pdf, Page page, string imageDir)
    {
        var result = new List<(double, double, ContentBlock)>();
        var index = 0;
        foreach (var image in page.GetImages())
        {
            index++;
            var extracted = ImageExtractor.TryExtract(image);
            ContentBlock block;
            if (extracted is not null)
            {
                var name = ImageFileName(page.Number, index, extracted.Extension);
                File.WriteAllBytes(Path.Combine(imageDir, name), extracted.Bytes);
                var dims = ImageInfo.Read(extracted.Bytes)!;
                block = new ContentBlock
                {
                    Type = BlockTypes.Image,
                    Src = name,
                    W = dims.Width,
                    H = dims.Height,
                    Sha256 = ImageExtractor.Sha256Hex(extracted.Bytes),
                };
            }
            else
            {
                block = RenderToFile(pdf, page, image.BoundingBox, imageDir, ImageFileName(page.Number, index, "png"));
            }

            result.Add((image.BoundingBox.Top, image.BoundingBox.Left, block));
        }

        return result;
    }

    private ContentBlock RenderToFile(byte[] pdf, Page page, PdfRectangle? region, string imageDir, string name)
    {
        var rendered = renderer.Render(pdf, page.Number - 1, FallbackRenderScale);
        if (region is { } r)
        {
            var sx = rendered.Width / page.Width;
            var sy = rendered.Height / page.Height;
            rendered = rendered.Crop(
                (int)Math.Floor(r.Left * sx),
                (int)Math.Floor((page.Height - r.Top) * sy),
                (int)Math.Ceiling(r.Width * sx),
                (int)Math.Ceiling(r.Height * sy));
        }

        var png = rendered.ToPng();
        File.WriteAllBytes(Path.Combine(imageDir, name), png);
        return new ContentBlock
        {
            Type = BlockTypes.Image,
            Src = name,
            W = rendered.Width,
            H = rendered.Height,
            Sha256 = ImageExtractor.Sha256Hex(png),
            Rendered = true,
        };
    }

    private byte[]? TryRenderCover(byte[] pdf, PdfDocument doc)
    {
        if (doc.NumberOfPages == 0)
        {
            return null;
        }

        try
        {
            var first = doc.GetPage(1);
            return renderer.Render(pdf, 0, CoverWidth / first.Width).ToPng();
        }
        catch (Exception)
        {
            return null; // A missing cover is cosmetic; the UI shows a placeholder.
        }
    }

    private static (string Title, string? Author) ReadMetadata(PdfDocument doc, string fallbackTitle)
    {
        var title = doc.Information.Title?.Trim();
        const string wordPrefix = "Microsoft Word - ";
        if (title is not null && title.StartsWith(wordPrefix, StringComparison.OrdinalIgnoreCase))
        {
            title = Path.GetFileNameWithoutExtension(title[wordPrefix.Length..]);
        }

        if (IsPlaceholderTitle(title))
        {
            title = fallbackTitle;
        }

        var author = doc.Information.Author?.Trim();
        return (Truncate(title, 300), string.IsNullOrWhiteSpace(author) ? null : Truncate(author, 300));
    }

    /// <summary>Metadata titles that are really file names or editor defaults ("novel.html", "Document1").</summary>
    public static bool IsPlaceholderTitle([NotNullWhen(false)] string? title) =>
        string.IsNullOrWhiteSpace(title) || PlaceholderTitleRegex().IsMatch(title.Trim());

    [GeneratedRegex(@"^(untitled\s*\d*|document\s*\d*|.+\.(html?|xhtml|docx?|odt|rtf|txt|md|tex|pdf|indd|pages|epub))$", RegexOptions.IgnoreCase)]
    private static partial Regex PlaceholderTitleRegex();

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
