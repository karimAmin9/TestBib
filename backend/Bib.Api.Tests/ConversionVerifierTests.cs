using Bib.Api.Conversion;
using Bib.Api.Tests.Fixtures;

namespace Bib.Api.Tests;

/// <summary>
/// Mutation tests for the proof-reader: a correct conversion is corrupted on purpose and the
/// verifier must catch every corruption, while the untouched conversion must pass.
/// </summary>
public sealed class ConversionVerifierTests : IDisposable
{
    private readonly ConversionHarness _h = new();
    private readonly byte[] _pdf;
    private readonly List<ProcessedChapter> _clean;

    public ConversionVerifierTests()
    {
        _pdf = new FixturePdf()
            .Page(p => p
                .Paragraph("The keeper climbed the stairs every evening.")
                .Jpeg(TestImages.SampleJpeg(), 128, 96)
                .Paragraph("He lit the lamp and wrote in the logbook.")
                .Png(TestImages.EncodePng(TestImages.Pattern(30, 20, 5)), 90, 60)
                .Text("1", 297, 30))
            .Page(p => p.Paragraph("Second page text stays untouched."))
            .Build();
        _clean = _h.Process(_pdf).Chapters.ToList();
    }

    public void Dispose() => _h.Dispose();

    private ProcessedChapter Page1 => _clean[0];

    [Fact]
    public void Clean_conversion_passes()
    {
        var report = _h.Verify(_pdf, _clean);

        Assert.Equal(PageStatus.Pass, report.Status);
        Assert.Equal(2, report.PagesPassed);
        Assert.Equal("p,img,p,img", ConversionHarness.Shape(Page1));
        Assert.Equal(2, report.Pages[0].SourceImages);
    }

    [Fact]
    public void Dropped_word_is_detected()
    {
        var page = Report(ReplaceText(0, t => t.Replace(" every", "")));

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains("every", page.MissingWords);
        Assert.Equal("eervy", Sorted(page.MissingCharacters));
    }

    [Fact]
    public void Injected_word_is_detected()
    {
        var page = Report(ReplaceText(0, t => t + " suddenly"));

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains("suddenly", page.ExtraWords);
        Assert.NotEmpty(page.ExtraCharacters);
    }

    [Fact]
    public void Changed_letter_is_detected()
    {
        var page = Report(ReplaceText(0, t => t.Replace("keeper", "keepar")));

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Equal("e", page.MissingCharacters);
        Assert.Equal("a", page.ExtraCharacters);
    }

    [Fact]
    public void Duplicated_paragraph_is_detected()
    {
        var blocks = Page1.Blocks.ToList();
        blocks.Insert(1, blocks[0]);

        var page = Report(Page1 with { Blocks = blocks });

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains("keeper", page.ExtraWords);
    }

    [Fact]
    public void Unrecorded_page_number_removal_is_detected()
    {
        var page = Report(Page1 with { Removed = [] });

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Equal("1", page.MissingCharacters);
    }

    [Fact]
    public void Swapped_paragraph_order_is_a_warning_not_a_failure()
    {
        var blocks = Page1.Blocks.ToList();
        (blocks[0], blocks[2]) = (blocks[2], blocks[0]);

        var page = Report(Page1 with { Blocks = blocks });

        Assert.Equal(PageStatus.Warning, page.Status);
        Assert.True(page.OrderSimilarity < ConversionVerifier.OrderWarningThreshold);
    }

    [Fact]
    public void Missing_image_file_is_detected()
    {
        File.Delete(Path.Combine(_h.ImageDir, Page1.Blocks[1].Src!));

        var page = Report(Page1);

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains(page.ImageIssues, i => i.Contains("missing"));
    }

    [Fact]
    public void Missing_image_block_is_detected()
    {
        var page = Report(Page1 with { Blocks = Page1.Blocks.Where((_, i) => i != 3).ToList() });

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains(page.ImageIssues, i => i.Contains("#2 are missing"));
    }

    [Fact]
    public void Swapped_image_files_are_detected()
    {
        var a = Path.Combine(_h.ImageDir, Page1.Blocks[1].Src!);
        var b = Path.Combine(_h.ImageDir, Page1.Blocks[3].Src!);
        var bytesA = File.ReadAllBytes(a);
        File.WriteAllBytes(a, File.ReadAllBytes(b));
        File.WriteAllBytes(b, bytesA);

        var page = Report(Page1);

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains(page.ImageIssues, i => i.Contains("checksum mismatch"));
    }

    [Fact]
    public void Image_replaced_with_a_resized_copy_is_detected_even_with_updated_metadata()
    {
        var block = Page1.Blocks[3];
        var resized = TestImages.EncodePng(TestImages.Pattern(15, 10, 5));
        File.WriteAllBytes(Path.Combine(_h.ImageDir, block.Src!), resized);
        var forged = block with { W = 15, H = 10, Sha256 = ImageExtractor.Sha256Hex(resized) };

        var page = Report(Page1 with { Blocks = Page1.Blocks.Select(b => b == block ? forged : b).ToList() });

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains(page.ImageIssues, i => i.Contains("differs from image #2"));
        Assert.Contains(page.ImageIssues, i => i.Contains("PDF image is 30x20"));
    }

    [Fact]
    public void Corrupted_image_file_is_detected()
    {
        var path = Path.Combine(_h.ImageDir, Page1.Blocks[3].Src!);
        var bytes = File.ReadAllBytes(path);
        File.WriteAllBytes(path, bytes[..(bytes.Length / 2)]);

        var page = Report(Page1);

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains(page.ImageIssues, i => i.Contains("not a decodable"));
    }

    [Fact]
    public void Image_pointing_to_another_page_is_detected()
    {
        var forged = Page1.Blocks[1] with { Src = "p2-1.jpg" };

        var page = Report(Page1 with { Blocks = Page1.Blocks.Select((b, i) => i == 1 ? forged : b).ToList() });

        Assert.Equal(PageStatus.Fail, page.Status);
        Assert.Contains(page.ImageIssues, i => i.Contains("does not belong to page 1"));
    }

    [Fact]
    public void Missing_chapter_fails_the_book()
    {
        var report = _h.Verify(_pdf, [_clean[0]]);

        Assert.Equal(PageStatus.Fail, report.Status);
        Assert.Equal(PageStatus.Fail, report.Pages[1].Status);
        Assert.Contains(report.Notes, n => n.Contains("2 pages but 1 chapters"));
    }

    [Fact]
    public void Extra_chapter_fails_the_book()
    {
        var report = _h.Verify(_pdf, [.. _clean, new ProcessedChapter(3, [ContentBlock.Paragraph("ghost")], [])]);

        Assert.Equal(PageStatus.Fail, report.Status);
        Assert.Contains(report.Notes, n => n.Contains("Chapter 3 does not correspond"));
    }

    [Fact]
    public void Chapters_from_another_page_are_detected()
    {
        var report = _h.Verify(_pdf, [_clean[0], _clean[0] with { Number = 2 }]);

        Assert.Equal(PageStatus.Fail, report.Pages[1].Status);
    }

    private PageVerification Report(ProcessedChapter page1) =>
        _h.Verify(_pdf, [page1, _clean[1]]).Pages[0];

    private ProcessedChapter ReplaceText(int blockIndex, Func<string, string> change)
    {
        var blocks = Page1.Blocks.ToList();
        blocks[blockIndex] = blocks[blockIndex] with { Text = change(blocks[blockIndex].Text!) };
        return Page1 with { Blocks = blocks };
    }

    private static string Sorted(string s) => new(s.Order().ToArray());
}
