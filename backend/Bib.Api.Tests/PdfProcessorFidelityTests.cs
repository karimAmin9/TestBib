using Bib.Api.Conversion;
using Bib.Api.Tests.Fixtures;

namespace Bib.Api.Tests;

/// <summary>
/// Ground-truth tests: the PDFs are generated in code, so the exact words and images are known
/// and the converted output must match them 1:1.
/// </summary>
public sealed class PdfProcessorFidelityTests : IDisposable
{
    private readonly ConversionHarness _h = new();

    public void Dispose() => _h.Dispose();

    [Fact]
    public void Paragraphs_over_several_pages_are_reproduced_exactly_and_in_order()
    {
        var pdf = new FixturePdf()
            .Page(p => p
                .Paragraph("The old lighthouse stood at the edge of the cliff,", "watching the grey sea for a hundred years.")
                .Paragraph("Nobody remembered who had built it."))
            .Page(p => p
                .Paragraph("On the second night the lamp went out.")
                .Paragraph("Mara climbed the stairs with a candle,", "counting every step.", "There were exactly two hundred."))
            .Page(p => p.Paragraph("The end."))
            .Build();

        var book = _h.Process(pdf);

        Assert.Equal(3, book.PageCount);
        Assert.Equal([1, 2, 3], book.Chapters.Select(c => c.Number));
        Assert.Equal(
            ["The old lighthouse stood at the edge of the cliff, watching the grey sea for a hundred years.", "Nobody remembered who had built it."],
            ConversionHarness.Paragraphs(book.Chapters[0]));
        Assert.Equal(
            ["On the second night the lamp went out.", "Mara climbed the stairs with a candle, counting every step. There were exactly two hundred."],
            ConversionHarness.Paragraphs(book.Chapters[1]));
        Assert.Equal(["The end."], ConversionHarness.Paragraphs(book.Chapters[2]));
        Assert.All(book.Chapters, c => Assert.Empty(c.Removed));
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Hyphenated_line_breaks_are_joined_and_the_hyphen_is_recorded()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("This sentence contains an exam-", "ple of hyphenation and a well-known", "compound word."))
            .Build();

        var chapter = _h.Process(pdf).Chapters[0];

        Assert.Equal(["This sentence contains an example of hyphenation and a well-known compound word."], ConversionHarness.Paragraphs(chapter));
        Assert.Equal([new Removal(RemovalKinds.Hyphen, "-")], chapter.Removed);
        AssertVerified(pdf, _h.Process(pdf));
    }

    [Fact]
    public void Two_columns_are_read_left_column_first()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Columns(
                ["Left column line one", "left column line two", "left column line three"],
                ["Right column line one", "right column line two", "right column line three"]))
            .Build();

        var chapter = _h.Process(pdf).Chapters[0];

        Assert.Equal(
            ["Left column line one left column line two left column line three", "Right column line one right column line two right column line three"],
            ConversionHarness.Paragraphs(chapter));
        AssertVerified(pdf, _h.Process(pdf));
    }

    [Fact]
    public void Jpeg_between_paragraphs_is_byte_identical_and_in_position()
    {
        var jpeg = TestImages.SampleJpeg();
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Before the picture.").Jpeg(jpeg, 128, 96).Paragraph("After the picture."))
            .Build();

        var book = _h.Process(pdf);
        var chapter = book.Chapters[0];

        Assert.Equal("p,img,p", ConversionHarness.Shape(chapter));
        Assert.Equal(["Before the picture.", "After the picture."], ConversionHarness.Paragraphs(chapter));
        var img = chapter.Blocks[1];
        Assert.Equal("p1-1.jpg", img.Src);
        Assert.Equal((64, 48), (img.W!.Value, img.H!.Value));
        Assert.Equal(jpeg, _h.ReadImage(img.Src!));
        Assert.Null(img.Rendered);
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Png_between_paragraphs_is_pixel_identical_and_in_position()
    {
        var pattern = TestImages.Pattern(40, 30, seed: 3);
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Text above.").Png(TestImages.EncodePng(pattern), 160, 120).Paragraph("Text below."))
            .Build();

        var book = _h.Process(pdf);
        var chapter = book.Chapters[0];

        Assert.Equal("p,img,p", ConversionHarness.Shape(chapter));
        var img = chapter.Blocks[1];
        Assert.EndsWith(".png", img.Src);
        var decoded = TestImages.DecodePng(_h.ReadImage(img.Src!));
        Assert.Equal(pattern.Width, decoded.Width);
        Assert.Equal(pattern.Height, decoded.Height);
        Assert.Equal(pattern.Rgb, decoded.Rgb);
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Multiple_images_keep_their_vertical_order()
    {
        var first = TestImages.Pattern(20, 10, seed: 1);
        var second = TestImages.Pattern(10, 20, seed: 2);
        var pdf = new FixturePdf()
            .Page(p => p
                .Png(TestImages.EncodePng(first), 100, 50)
                .Paragraph("Between the two images.")
                .Png(TestImages.EncodePng(second), 50, 100))
            .Build();

        var book = _h.Process(pdf);
        var chapter = book.Chapters[0];

        Assert.Equal("img,p,img", ConversionHarness.Shape(chapter));
        Assert.Equal(first.Rgb, TestImages.DecodePng(_h.ReadImage(chapter.Blocks[0].Src!)).Rgb);
        Assert.Equal(second.Rgb, TestImages.DecodePng(_h.ReadImage(chapter.Blocks[2].Src!)).Rgb);
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Image_only_page_becomes_a_chapter_with_just_the_image()
    {
        var jpeg = TestImages.SampleJpeg();
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Chapter one."))
            .Page(p => p.Jpeg(jpeg, 400, 300))
            .Build();

        var book = _h.Process(pdf);

        Assert.Equal("img", ConversionHarness.Shape(book.Chapters[1]));
        Assert.Equal(jpeg, _h.ReadImage(book.Chapters[1].Blocks[0].Src!));
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Footer_page_numbers_are_removed_and_recorded()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Some story text that matters.").Text("7", 297, 30))
            .Page(p => p.Paragraph("Five people walked in.").Text("- 8 -", 290, 30))
            .Build();

        var book = _h.Process(pdf);

        Assert.Equal(["Some story text that matters."], ConversionHarness.Paragraphs(book.Chapters[0]));
        Assert.Equal([new Removal(RemovalKinds.PageNumber, "7")], book.Chapters[0].Removed);
        Assert.Equal(["Five people walked in."], ConversionHarness.Paragraphs(book.Chapters[1]));
        Assert.Equal([new Removal(RemovalKinds.PageNumber, "- 8 -")], book.Chapters[1].Removed);
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Large_short_lines_become_headings()
    {
        var pdf = new FixturePdf()
            .Page(p => p
                .Text("A Quiet Harbour", FixturePage.Left, 790, size: 20)
                .Paragraph("The boats came home before dark.", "Nobody spoke on the pier."))
            .Build();

        var book = _h.Process(pdf);
        var chapter = book.Chapters[0];

        Assert.Equal("h,p", ConversionHarness.Shape(chapter));
        Assert.Equal("A Quiet Harbour", chapter.Blocks[0].Text);
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Numbers_inside_the_text_body_are_kept()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Chapter").Paragraph("12").Paragraph("It was 1984."))
            .Build();

        var chapter = _h.Process(pdf).Chapters[0];

        Assert.Equal(["Chapter", "12", "It was 1984."], ConversionHarness.Paragraphs(chapter));
        Assert.Empty(chapter.Removed);
    }

    [Fact]
    public void Empty_page_still_produces_an_empty_chapter()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("First."))
            .Page(_ => { })
            .Page(p => p.Paragraph("Third."))
            .Build();

        var book = _h.Process(pdf);

        Assert.Equal(3, book.Chapters.Count);
        Assert.Empty(book.Chapters[1].Blocks);
        AssertVerified(pdf, book);
    }

    [Fact]
    public void Vector_only_page_is_rendered_as_one_image()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Rectangle())
            .Build();

        var chapter = _h.Process(pdf).Chapters[0];

        var block = Assert.Single(chapter.Blocks);
        Assert.Equal("p1-page.png", block.Src);
        Assert.True(block.Rendered);
        Assert.NotNull(ImageInfo.Read(_h.ReadImage(block.Src!)));
        AssertVerified(pdf, _h.Process(pdf));
    }

    [Fact]
    public void Metadata_title_and_author_are_used_with_filename_fallback()
    {
        var withInfo = new FixturePdf().WithInfo("The Lighthouse", "A. Keeper").Page(p => p.Paragraph("x y")).Build();
        var withoutInfo = new FixturePdf().Page(p => p.Paragraph("x y")).Build();

        var a = _h.Process(withInfo, "file-name");
        var b = _h.Process(withoutInfo, "file-name");

        Assert.Equal(("The Lighthouse", "A. Keeper"), (a.Title, a.Author));
        Assert.Equal(("file-name", (string?)null), (b.Title, b.Author));
    }

    [Fact]
    public void Cover_is_rendered_from_the_first_page()
    {
        var book = _h.Process(new FixturePdf().Page(p => p.Paragraph("Cover page")).Build());

        Assert.NotNull(book.CoverPng);
        var dims = ImageInfo.Read(book.CoverPng);
        Assert.NotNull(dims);
        Assert.InRange(dims.Width, PdfProcessor.CoverWidth - 2, PdfProcessor.CoverWidth + 2);
    }

    [Fact]
    public void Corrupt_file_throws_a_readable_error()
    {
        var ex = Assert.Throws<PdfProcessingException>(() => _h.Process("%PDF-1.7 this is not really a pdf"u8.ToArray()));
        Assert.Contains("could not be read", ex.Message);
    }

    [Fact]
    public void Chapter_count_always_equals_page_count()
    {
        var pdf = new FixturePdf();
        for (var i = 1; i <= 12; i++)
        {
            var n = i;
            pdf.Page(p => p.Paragraph($"Page body number {n}."));
        }

        var bytes = pdf.Build();
        var book = _h.Process(bytes);

        Assert.Equal(12, book.Chapters.Count);
        for (var i = 0; i < 12; i++)
        {
            Assert.Equal([$"Page body number {i + 1}."], ConversionHarness.Paragraphs(book.Chapters[i]));
        }

        AssertVerified(pdf: bytes, book);
    }

    private void AssertVerified(byte[] pdf, ProcessedBook book)
    {
        var report = _h.Verify(pdf, book.Chapters);
        var failures = report.Pages.Where(p => p.Status != PageStatus.Pass).Select(p => ConversionJson.Serialize(p));
        Assert.True(report.Status == PageStatus.Pass, string.Join("\n", report.Notes.Concat(failures)));
    }
}
