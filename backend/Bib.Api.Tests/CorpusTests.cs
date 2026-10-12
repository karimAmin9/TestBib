using Bib.Api.Conversion;
using Bib.Api.Tests.Fixtures;

namespace Bib.Api.Tests;

/// <summary>
/// Real-world PDFs printed by a browser from known source text (see Fixtures/corpus/generate.ps1).
/// The source .txt is the ground truth: every word must come out, in order, and every page must pass verification.
/// </summary>
public sealed class CorpusTests : IDisposable
{
    private readonly ConversionHarness _h = new();

    public void Dispose() => _h.Dispose();

    public static TheoryData<string> Documents => new() { "novel", "illustrated", "columns" };

    [Theory]
    [MemberData(nameof(Documents))]
    public void Every_page_passes_verification(string name)
    {
        var pdf = Corpus(name, "pdf");
        var book = _h.Process(pdf);

        var report = _h.Verify(pdf, book.Chapters);

        var problems = report.Pages.Where(p => p.Status != PageStatus.Pass).Select(p => ConversionJson.Serialize(p));
        Assert.True(report.Status == PageStatus.Pass, string.Join("\n", report.Notes.Concat(problems)));
        Assert.Equal(report.PageCount, report.PagesPassed);
    }

    [Theory]
    [MemberData(nameof(Documents))]
    public void All_source_words_come_out_exactly_and_in_order(string name)
    {
        var book = _h.Process(Corpus(name, "pdf"));

        var expected = File.ReadAllLines(TestImages.FixturePath(Path.Combine("corpus", $"{name}.txt")))
            .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("[img:", StringComparison.Ordinal))
            .Select(l => l.StartsWith("# ", StringComparison.Ordinal) ? l[2..] : l)
            .SelectMany(TextNormalizer.Words)
            .ToList();
        var actual = book.Chapters.SelectMany(ConversionHarness.Words).ToList();

        Assert.Equal(expected, actual);
    }

    [Fact]
    public void Novel_keeps_paragraphs_ligatures_and_umlauts()
    {
        var book = _h.Process(Corpus("novel", "pdf"));
        var paragraphs = book.Chapters.SelectMany(ConversionHarness.Paragraphs).ToList();

        Assert.Contains("Chapter One: The Lighthouse Keeper", paragraphs);
        Assert.Contains(paragraphs, p => p.Contains("Efficient, he thought, and affluent, and flawless"));
        Assert.Contains(paragraphs, p => p.Contains("Sie hieß Jördis, kam angeblich aus Größenwald"));
        Assert.Contains(paragraphs, p => p.StartsWith("„Ich suche jemanden\"", StringComparison.Ordinal) || p.Contains("„Ich suche jemanden\""));
        Assert.True(book.Chapters.Count >= 3, "each chapter heading starts a new page");
    }

    [Fact]
    public void Illustrated_images_match_the_source_pictures()
    {
        var book = _h.Process(Corpus("illustrated", "pdf"));
        var images = book.Chapters.SelectMany(c => c.Blocks).Where(b => b.Type == BlockTypes.Image).ToList();

        Assert.Equal(3, images.Count);
        Assert.All(images, i => Assert.Null(i.Rendered));

        var pattern = TestImages.DecodePng(File.ReadAllBytes(TestImages.FixturePath(Path.Combine("corpus", "pattern.png"))));
        var first = TestImages.DecodePng(_h.ReadImage(images[0].Src!));
        Assert.Equal((pattern.Width, pattern.Height), (first.Width, first.Height));
        Assert.Equal(pattern.Rgb, first.Rgb);

        var jpeg = ImageInfo.Read(_h.ReadImage(images[1].Src!));
        Assert.Equal((64, 48), (jpeg!.Width, jpeg.Height));

        var pattern2 = TestImages.DecodePng(File.ReadAllBytes(TestImages.FixturePath(Path.Combine("corpus", "pattern2.png"))));
        var third = TestImages.DecodePng(_h.ReadImage(images[2].Src!));
        Assert.Equal(pattern2.Rgb, third.Rgb);
    }

    private static byte[] Corpus(string name, string ext) =>
        File.ReadAllBytes(TestImages.FixturePath(Path.Combine("corpus", $"{name}.{ext}")));
}
