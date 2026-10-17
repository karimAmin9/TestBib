using Bib.Api.Tests.Fixtures;
using Bib.Conversion;

namespace Bib.Api.Tests;

/// <summary>
/// Books organized into chapters: blocks carry their page and reading position, and the verifier puts them back
/// in place, so reorganizing never weakens the 1:1 check.
/// </summary>
public sealed class AssembledBookTests : IDisposable
{
    private readonly ConversionHarness _h = new();

    public void Dispose() => _h.Dispose();

    private static byte[] TwoPages() => new FixturePdf()
        .Page(p => p
            .Paragraph("The fog came in early that autumn,", "rolling over the harbour.")
            .BoldParagraph(9, "Left: the lighthouse in 1911.")
            .Png(TestImages.EncodePng(TestImages.Pattern(40, 30, seed: 3)), 120, 90))
        .Page(p => p
            .Paragraph("Elias had kept the lighthouse", "for thirty-one years.")
            .Paragraph("He wound the clock every morning."))
        .Build();

    [Fact]
    public void Blocks_carry_their_page_reading_position_and_layout()
    {
        var book = _h.Process(TwoPages());

        var page1 = book.Chapters[0];
        Assert.True(page1.Width > 500 && page1.Height > 800); // A4 in points
        Assert.Equal(["p1-b0", "p1-b1", "p1-b2"], page1.Blocks.Select(b => b.Id));
        Assert.All(page1.Blocks, b => Assert.Equal(1, b.Page));
        Assert.Equal([0, 1, 2], page1.Blocks.Select(b => b.Seq!.Value));

        var body = page1.Blocks[0].Layout!;
        var caption = page1.Blocks[1].Layout!;
        var image = page1.Blocks[2].Layout!;
        Assert.Equal(12, body.FontSize);
        Assert.False(body.Bold);
        Assert.Equal(9, caption.FontSize);
        Assert.True(caption.Bold);
        Assert.Equal(120, image.W);
        Assert.True(body.Y < caption.Y && caption.Y < image.Y); // top-left origin, top to bottom
    }

    [Fact]
    public void Reads_the_pdf_outline()
    {
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Preface."))
            .Page(p => p.Paragraph("Chapter one."))
            .Bookmark("Preface", 1)
            .Bookmark("Chapter One", 2)
            .Build();

        Assert.Equal(
            [new OutlineEntry("Preface", 1, 0), new OutlineEntry("Chapter One", 2, 0)],
            _h.Process(pdf).Outline!);
        Assert.Empty(_h.Process(TwoPages()).Outline!);
    }

    [Fact]
    public void A_reorganized_book_still_verifies_1_to_1()
    {
        var pdf = TwoPages();
        var pages = _h.Process(pdf).Chapters;
        var all = pages.SelectMany(p => p.Blocks).ToList();
        // Chapter 1: the text of both pages joined, chapter 2: the figure (caption + image) moved to the end.
        var chapters = new List<IReadOnlyList<ContentBlock>>
        {
            new[] { all[0], all[3] with { Cont = true }, all[4] },
            new[] { all[2] with { Figure = "f1" }, all[1] with { Figure = "f1", Role = "caption" } },
        };

        var report = Verify(pdf, pages, chapters);

        Assert.Equal(PageStatus.Pass, report.Status);
    }

    [Fact]
    public void A_lost_or_duplicated_block_fails_its_page()
    {
        var pdf = TwoPages();
        var pages = _h.Process(pdf).Chapters;
        var all = pages.SelectMany(p => p.Blocks).ToList();

        var lost = Verify(pdf, pages, One(all.Where(b => b.Id != "p2-b1")));
        var duplicated = Verify(pdf, pages, One(all, all[3]));

        Assert.Equal(PageStatus.Fail, lost.Pages[1].Status);
        Assert.Equal(PageStatus.Pass, lost.Pages[0].Status);
        Assert.Equal(PageStatus.Fail, duplicated.Pages[1].Status);
    }

    [Fact]
    public void Changed_text_fails_but_recorded_scan_fixes_do_not()
    {
        var pdf = TwoPages();
        var pages = _h.Process(pdf).Chapters;
        var all = pages.SelectMany(p => p.Blocks).ToList();

        var edited = Verify(pdf, pages, One(all.Select(b => b.Id == "p2-b1" ? b with { Text = "He wound the clock every evening." } : b)));
        var fixedUp = Verify(pdf, pages, One(all.Select(b => b.Id == "p2-b1" ? b with { Fixes = [new TextFix(3, 5, "wind")] } : b)));

        Assert.Equal(PageStatus.Fail, edited.Pages[1].Status);
        Assert.Equal(PageStatus.Pass, fixedUp.Status);
    }

    [Fact]
    public void Left_out_page_furniture_must_be_recorded()
    {
        var pdf = TwoPages();
        var pages = _h.Process(pdf).Chapters;
        var all = pages.SelectMany(p => p.Blocks).ToList();
        var caption = all[1];
        var without = all.Where(b => b != caption).ToList();

        var unrecorded = Verify(pdf, pages, One(without));
        var recorded = Verify(pdf, pages, One(without), [new PageRemoval(1, RemovalKinds.Artifact, caption.Text!)]);

        Assert.Equal(PageStatus.Fail, unrecorded.Pages[0].Status);
        Assert.Equal(PageStatus.Pass, recorded.Status);
    }

    [Fact]
    public void A_word_broken_between_two_blocks_counts_as_one_word()
    {
        // A column (or text frame) ends mid-word; the reader joins the blocks, the check compares "ziemlich".
        var pdf = new FixturePdf()
            .Page(p => p.Paragraph("Man kann ziem-").Paragraph("lich leicht erkennen, was er meint."))
            .Build();
        var pages = _h.Process(pdf).Chapters;
        Assert.Equal(["Man kann ziem-", "lich leicht erkennen, was er meint."], pages[0].Blocks.Select(b => b.Text));

        var report = Verify(pdf, pages, One(pages[0].Blocks.Select((b, i) => i == 1 ? b with { Cont = true } : b)));

        Assert.Equal(PageStatus.Pass, report.Status);
    }

    [Fact]
    public void Blocks_without_a_source_page_fail_the_book()
    {
        var pdf = TwoPages();
        var pages = _h.Process(pdf).Chapters;
        var all = pages.SelectMany(p => p.Blocks).ToList();

        var report = Verify(pdf, pages, One(all, ContentBlock.Paragraph("Invented.")));

        Assert.Equal(PageStatus.Fail, report.Status);
        Assert.Contains(report.Notes, n => n.Contains("no source page"));
    }

    /// <summary>A book with a single chapter holding these blocks.</summary>
    private static List<IReadOnlyList<ContentBlock>> One(IEnumerable<ContentBlock> blocks, params ContentBlock[] more) =>
        [blocks.Concat(more).ToList()];

    private VerificationReport Verify(
        byte[] pdf,
        IReadOnlyList<ProcessedChapter> pages,
        IReadOnlyList<IReadOnlyList<ContentBlock>> chapters,
        IReadOnlyList<PageRemoval>? extraRemovals = null)
    {
        // The removals the processor recorded per page travel with the assembled book.
        var removed = pages.SelectMany(p => p.Removed.Select(r => new PageRemoval(p.Number, r.Kind, r.Text)))
            .Concat(extraRemovals ?? [])
            .ToList();
        return _h.Verifier.VerifyAssembled(pdf, new AssembledBook(pages.Count, chapters, removed), _h.ImageDir);
    }
}
