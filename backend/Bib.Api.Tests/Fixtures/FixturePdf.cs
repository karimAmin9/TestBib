using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
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

    public FixturePdf()
    {
        _font = _builder.AddStandard14Font(Standard14Font.Helvetica);
    }

    public FixturePdf WithInfo(string? title, string? author)
    {
        _builder.DocumentInformation.Title = title;
        _builder.DocumentInformation.Author = author;
        return this;
    }

    public FixturePdf Page(Action<FixturePage> build)
    {
        build(new FixturePage(_builder.AddPage(PageSize.A4), _font));
        return this;
    }

    public byte[] Build() => _builder.Build();
}

public sealed class FixturePage(PdfPageBuilder page, PdfDocumentBuilder.AddedFont font)
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
