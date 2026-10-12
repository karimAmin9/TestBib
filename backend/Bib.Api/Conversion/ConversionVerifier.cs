using System.Text.RegularExpressions;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.DocumentLayoutAnalysis.TextExtractor;

namespace Bib.Api.Conversion;

/// <summary>
/// Proof-reads a conversion: re-opens the original PDF independently and checks, page by page,
/// that the stored chapters contain exactly the PDF's text and images.
/// </summary>
public sealed partial class ConversionVerifier
{
    /// <summary>Word-order similarity (LCS ratio) below which a page gets a warning.</summary>
    public const double OrderWarningThreshold = 0.98;

    private const int MaxListedDiffs = 50;
    private const int MaxLcsWords = 6000;

    public VerificationReport Verify(byte[] pdf, IReadOnlyList<ProcessedChapter> chapters, string imageDir)
    {
        using var doc = PdfProcessor.Open(pdf);
        var notes = new List<string>();
        var pages = new List<PageVerification>(doc.NumberOfPages);
        var byNumber = chapters.GroupBy(c => c.Number).ToDictionary(g => g.Key, g => g.ToList());

        if (chapters.Count != doc.NumberOfPages)
        {
            notes.Add($"The PDF has {doc.NumberOfPages} pages but {chapters.Count} chapters were stored.");
        }

        foreach (var (number, list) in byNumber.Where(kv => kv.Value.Count > 1))
        {
            notes.Add($"Chapter {number} is stored {list.Count} times.");
        }

        foreach (var extra in byNumber.Keys.Where(k => k < 1 || k > doc.NumberOfPages).Order())
        {
            notes.Add($"Chapter {extra} does not correspond to a page in the PDF.");
        }

        for (var n = 1; n <= doc.NumberOfPages; n++)
        {
            var page = doc.GetPage(n);
            pages.Add(byNumber.TryGetValue(n, out var found)
                ? VerifyPage(page, found[0], imageDir)
                : new PageVerification { Page = n, Status = PageStatus.Fail, Notes = ["No chapter was stored for this page."] });
        }

        var failed = pages.Count(p => p.Status == PageStatus.Fail);
        var warned = pages.Count(p => p.Status == PageStatus.Warning);
        var status = failed > 0 || notes.Count > 0 ? PageStatus.Fail
            : warned > 0 ? PageStatus.Warning
            : PageStatus.Pass;

        return new VerificationReport
        {
            Status = status,
            PageCount = doc.NumberOfPages,
            PagesPassed = pages.Count - failed - warned,
            PagesWithWarnings = warned,
            PagesFailed = failed,
            Notes = notes,
            Pages = pages,
        };
    }

    private static PageVerification VerifyPage(Page page, ProcessedChapter chapter, string imageDir)
    {
        var notes = new List<string>();
        var paragraphs = chapter.Blocks.Where(b => b.Type == BlockTypes.Paragraph).Select(b => b.Text ?? "").ToList();
        var unknownBlocks = chapter.Blocks.Count(b => b.Type is not (BlockTypes.Paragraph or BlockTypes.Image));
        if (unknownBlocks > 0)
        {
            notes.Add($"{unknownBlocks} block(s) have an unknown type.");
        }

        // 1. Characters: every glyph in the PDF's text layer must appear exactly once in the output
        //    (paragraph text plus the recorded removals) and nothing may be added.
        var sourceGlyphs = TextNormalizer.Glyphs(string.Concat(page.Letters.Select(l => l.Value)));
        var outputGlyphs = TextNormalizer.Glyphs(
            string.Concat(paragraphs) + string.Concat(chapter.Removed.Select(r => r.Text)));
        var missingChars = TextNormalizer.CharacterDiff(sourceGlyphs, outputGlyphs);
        var extraChars = TextNormalizer.CharacterDiff(outputGlyphs, sourceGlyphs);

        // 2. Words: compare word multisets, independently segmented from the PDF content stream.
        var sourceWords = TextNormalizer.Dehyphenate(
            TextNormalizer.Words(ContentOrderTextExtractor.GetText(page)));
        foreach (var pageNumber in chapter.Removed.Where(r => r.Kind == RemovalKinds.PageNumber))
        {
            foreach (var w in TextNormalizer.Words(pageNumber.Text))
            {
                sourceWords.Remove(w);
            }
        }

        var outputWords = paragraphs.SelectMany(TextNormalizer.Words).ToList();
        var missingWords = MultisetDiff(sourceWords, outputWords);
        var extraWords = MultisetDiff(outputWords, sourceWords);

        // 3. Order: reading order may legitimately differ from content-stream order (columns),
        //    so a low similarity is a warning, not a failure.
        double order = 1;
        if (sourceWords.Count <= MaxLcsWords && outputWords.Count <= MaxLcsWords)
        {
            order = OrderSimilarity(sourceWords, outputWords);
        }
        else
        {
            notes.Add("Page too long for word-order comparison.");
        }

        // 4. Images.
        var sourceImages = page.GetImages().ToList();
        var imageBlocks = chapter.Blocks.Where(b => b.Type == BlockTypes.Image).ToList();
        var imageIssues = VerifyImages(page, sourceImages, imageBlocks, imageDir);

        var fail = missingChars.Length > 0 || extraChars.Length > 0 || imageIssues.Count > 0 || unknownBlocks > 0;
        var warn = missingWords.Count > 0 || extraWords.Count > 0 || order < OrderWarningThreshold;

        return new PageVerification
        {
            Page = page.Number,
            Status = fail ? PageStatus.Fail : warn ? PageStatus.Warning : PageStatus.Pass,
            SourceCharacters = sourceGlyphs.Length,
            OutputCharacters = outputGlyphs.Length,
            MissingCharacters = Cap(missingChars),
            ExtraCharacters = Cap(extraChars),
            MissingWords = missingWords.Take(MaxListedDiffs).ToList(),
            ExtraWords = extraWords.Take(MaxListedDiffs).ToList(),
            OrderSimilarity = Math.Round(order, 4),
            SourceImages = sourceImages.Count,
            OutputImages = imageBlocks.Count,
            ImageIssues = imageIssues,
            Notes = notes,
        };
    }

    private static List<string> VerifyImages(
        Page page, IReadOnlyList<IPdfImage> sourceImages, IReadOnlyList<ContentBlock> blocks, string imageDir)
    {
        var issues = new List<string>();
        var seen = new HashSet<int>();
        var pageRenders = 0;

        foreach (var block in blocks)
        {
            var src = block.Src ?? "";
            var match = ImageNameRegex().Match(src);
            if (!match.Success || int.Parse(match.Groups["page"].Value) != page.Number)
            {
                issues.Add($"Image '{src}' does not belong to page {page.Number}.");
                continue;
            }

            var path = Path.Combine(imageDir, src);
            if (!File.Exists(path))
            {
                issues.Add($"Image file '{src}' is missing.");
                continue;
            }

            var bytes = File.ReadAllBytes(path);
            var fileHash = ImageExtractor.Sha256Hex(bytes);
            if (!string.Equals(fileHash, block.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                issues.Add($"Image file '{src}' was changed after conversion (checksum mismatch).");
            }

            var dims = ImageInfo.Read(bytes);
            if (dims is null)
            {
                issues.Add($"Image file '{src}' is not a decodable PNG/JPEG.");
                continue;
            }

            if (dims.Width != block.W || dims.Height != block.H)
            {
                issues.Add($"Image '{src}' is {dims.Width}x{dims.Height} but {block.W}x{block.H} was recorded.");
            }

            if (match.Groups["index"].Value == "page")
            {
                pageRenders++;
                if (page.Letters.Count > 0 || sourceImages.Count > 0)
                {
                    issues.Add($"Page {page.Number} was rendered as a whole although it has extractable content.");
                }

                continue;
            }

            var index = int.Parse(match.Groups["index"].Value);
            if (index < 1 || index > sourceImages.Count)
            {
                issues.Add($"Image '{src}' has no matching image in the PDF.");
                continue;
            }

            if (!seen.Add(index))
            {
                issues.Add($"PDF image #{index} appears more than once.");
                continue;
            }

            var source = sourceImages[index - 1];
            var reExtracted = ImageExtractor.TryExtract(source);
            if (block.Rendered == true)
            {
                if (reExtracted is not null)
                {
                    issues.Add($"Image '{src}' was rendered although the original image is extractable.");
                }

                continue;
            }

            if (reExtracted is null)
            {
                issues.Add($"PDF image #{index} could not be re-extracted for comparison.");
                continue;
            }

            if (ImageExtractor.Sha256Hex(reExtracted.Bytes) != fileHash)
            {
                issues.Add($"Image '{src}' differs from image #{index} in the PDF.");
            }

            if (dims.Width != source.WidthInSamples || dims.Height != source.HeightInSamples)
            {
                issues.Add(
                    $"Image '{src}' is {dims.Width}x{dims.Height} but the PDF image is {source.WidthInSamples}x{source.HeightInSamples}.");
            }
        }

        var missing = Enumerable.Range(1, sourceImages.Count).Where(i => !seen.Contains(i)).ToList();
        if (missing.Count > 0)
        {
            issues.Add($"PDF image(s) #{string.Join(", #", missing)} are missing from the output.");
        }

        if (pageRenders > 1)
        {
            issues.Add("The page was rendered more than once.");
        }

        return issues;
    }

    private static List<string> MultisetDiff(IReadOnlyList<string> from, IReadOnlyList<string> minus)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var w in minus)
        {
            counts[w] = counts.GetValueOrDefault(w) + 1;
        }

        var result = new List<string>();
        foreach (var w in from)
        {
            if (counts.GetValueOrDefault(w) > 0)
            {
                counts[w]--;
            }
            else
            {
                result.Add(w);
            }
        }

        return result;
    }

    /// <summary>Length of the longest common subsequence divided by the longer sequence length.</summary>
    public static double OrderSimilarity(IReadOnlyList<string> a, IReadOnlyList<string> b)
    {
        if (a.Count == 0 && b.Count == 0)
        {
            return 1;
        }

        var prev = new int[b.Count + 1];
        var curr = new int[b.Count + 1];
        for (var i = 1; i <= a.Count; i++)
        {
            for (var j = 1; j <= b.Count; j++)
            {
                curr[j] = string.Equals(a[i - 1], b[j - 1], StringComparison.Ordinal)
                    ? prev[j - 1] + 1
                    : Math.Max(prev[j], curr[j - 1]);
            }

            (prev, curr) = (curr, prev);
        }

        return (double)prev[b.Count] / Math.Max(a.Count, b.Count);
    }

    private static string Cap(string s) => s.Length <= 200 ? s : s[..200] + "…";

    [GeneratedRegex(@"^p(?<page>\d+)-(?<index>\d+|page)\.(png|jpg)$")]
    public static partial Regex ImageNameRegex();
}
