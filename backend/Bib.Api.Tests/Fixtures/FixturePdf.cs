using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Outline;
using UglyToad.PdfPig.Outline.Destinations;
using UglyToad.PdfPig.Writer;

namespace Bib.Api.Tests.Fixtures;

/// <summary>
/// Builds ground-truth PDFs in code: tests know exactly which words and images went in.
/// Layout: A4 portrait, text at 12pt with 16pt leading, paragraphs separated by a blank line.
/// </summary>
public sealed class FixturePdf
{
    private readonly PdfDocumentBuilder _builder = new();
    private readonly PdfDocumentBuilder.AddedFont _font;
    private readonly PdfDocumentBuilder.AddedFont _bold;
    private readonly List<BookmarkNode> _bookmarks = [];

    public FixturePdf()
    {
        _font = _builder.AddStandard14Font(Standard14Font.Helvetica);
        _bold = _builder.AddStandard14Font(Standard14Font.HelveticaBold);
    }

    /// <summary>Adds a bookmark (outline entry) pointing at the 1-based page.</summary>
    public FixturePdf Bookmark(string title, int page)
    {
        _bookmarks.Add(new DocumentBookmarkNode(
            title, 0, new ExplicitDestination(page, ExplicitDestinationType.FitPage, ExplicitDestinationCoordinates.Empty), []));
        return this;
    }

    public FixturePdf WithInfo(string? title, string? author)
    {
        _builder.DocumentInformation.Title = title;
        _builder.DocumentInformation.Author = author;
        return this;
    }

    public FixturePdf Page(Action<FixturePage> build)
    {
        build(new FixturePage(_builder.AddPage(PageSize.A4), _font, _bold));
        return this;
    }

    public byte[] Build()
    {
        if (_bookmarks.Count > 0)
        {
            _builder.Bookmarks = new Bookmarks(_bookmarks);
        }

        return _builder.Build();
    }
}

public sealed class FixturePage(PdfPageBuilder page, PdfDocumentBuilder.AddedFont font, PdfDocumentBuilder.AddedFont bold)
{
    public const double Left = 72;
    public const double FontSize = 12;
    public const double Leading = 16;

    private double _y = 760;

    public PdfPageBuilder Raw => page;

    public FixturePage Paragraph(params string[] lines)
    {
        foreach (var line in lines)
        {
            page.AddText(line, FontSize, new PdfPoint(Left, _y), font);
            _y -= Leading;
        }

        _y -= Leading; // blank line between paragraphs
        return this;
    }

    /// <summary>
    /// Running text set like a book: no blank line between paragraphs, the first line of each indented by
    /// <paramref name="indent"/>; <paramref name="justify"/> stretches every line but a paragraph's last to the
    /// column width.
    /// </summary>
    public FixturePage BookText(double indent, bool justify, params string[][] paragraphs)
    {
        const double width = 420;
        foreach (var lines in paragraphs)
        {
            for (var i = 0; i < lines.Length; i++)
            {
                var x = Left + (i == 0 ? indent : 0);
                var words = lines[i].Split(' ');
                if (!justify || i == lines.Length - 1 || words.Length < 2)
                {
                    page.AddText(lines[i], FontSize, new PdfPoint(x, _y), font);
                }
                else
                {
                    var widths = words.Select(w => Width(w)).ToList();
                    var gap = (Left + width - x - widths.Sum()) / (words.Length - 1);
                    for (var w = 0; w < words.Length; w++)
                    {
                        page.AddText(words[w], FontSize, new PdfPoint(x, _y), font);
                        x += widths[w] + gap;
                    }
                }

                _y -= Leading;
            }
        }

        _y -= Leading;
        return this;
    }

    private double Width(string text)
    {
        var letters = page.MeasureText(text, FontSize, new PdfPoint(0, 0), font);
        return letters.Count == 0 ? 0 : letters.Max(l => l.EndBaseLine.X) - letters.Min(l => l.StartBaseLine.X);
    }

    /// <summary>A paragraph in bold at <paramref name="size"/>, e.g. a caption.</summary>
    public FixturePage BoldParagraph(double size, params string[] lines)
    {
        foreach (var line in lines)
        {
            page.AddText(line, size, new PdfPoint(Left, _y), bold);
            _y -= size * 1.35;
        }

        _y -= Leading;
        return this;
    }

    public FixturePage Png(byte[] png, double width, double height) => Image(png, width, height, jpeg: false);

    public FixturePage Jpeg(byte[] jpeg, double width, double height) => Image(jpeg, width, height, jpeg: true);

    public FixturePage Text(string text, double x, double y, double size = FontSize)
    {
        page.AddText(text, size, new PdfPoint(x, y), font);
        return this;
    }

    /// <summary>Two text columns side by side, starting at the current position.</summary>
    public FixturePage Columns(string[] left, string[] right)
    {
        var y = _y;
        foreach (var line in left)
        {
            page.AddText(line, FontSize, new PdfPoint(Left, y), font);
            y -= Leading;
        }

        y = _y;
        foreach (var line in right)
        {
            page.AddText(line, FontSize, new PdfPoint(320, y), font);
            y -= Leading;
        }

        _y -= Leading * (Math.Max(left.Length, right.Length) + 1);
        return this;
    }

    public FixturePage Rectangle()
    {
        page.DrawRectangle(new PdfPoint(100, 400), 300, 200, 4);
        return this;
    }

    private FixturePage Image(byte[] bytes, double width, double height, bool jpeg)
    {
        _y -= height;
        var rect = new PdfRectangle(Left, _y, Left + width, _y + height);
        if (jpeg)
        {
            page.AddJpeg(bytes, rect);
        }
        else
        {
            page.AddPng(bytes, rect);
        }

        _y -= Leading * 2;
        return this;
    }
}
