using Bib.Api.Conversion;
using Bib.Api.Tests.Fixtures;

namespace Bib.Api.Tests;

public sealed class TextNormalizerTests
{
    [Fact]
    public void Glyphs_splits_ligatures_and_drops_whitespace() =>
        Assert.Equal("officeflow", TextNormalizer.Glyphs("oﬃce ﬂow\n"));

    [Theory]
    [InlineData("exam-", "ple", true)]
    [InlineData("exam­", "ple", true)]
    [InlineData("well-", "Known", false)]
    [InlineData("1990-", "now", false)]
    [InlineData("-", "x", false)]
    public void Hyphen_break_detection(string end, string next, bool expected) =>
        Assert.Equal(expected, TextNormalizer.IsHyphenBreak(end, next));

    [Fact]
    public void Dehyphenate_joins_like_the_processor() =>
        Assert.Equal(["an", "example", "here"], TextNormalizer.Dehyphenate(["an", "exam-", "ple", "here"]));

    [Theory]
    [InlineData("12", true)]
    [InlineData("- 12 -", true)]
    [InlineData("xiv", true)]
    [InlineData("Chapter 12", false)]
    [InlineData("12345", false)]
    public void Page_number_detection(string text, bool expected) =>
        Assert.Equal(expected, TextNormalizer.LooksLikePageNumber(text));

    [Fact]
    public void Character_diff_is_a_multiset_difference()
    {
        Assert.Equal("ab", TextNormalizer.CharacterDiff("aabbc", "abc"));
        Assert.Equal("", TextNormalizer.CharacterDiff("abc", "cba"));
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("  ", true)]
    [InlineData("novel.html", true)]
    [InlineData("Chapter 1.docx", true)]
    [InlineData("Untitled", true)]
    [InlineData("Document1", true)]
    [InlineData("The Lighthouse Keeper", false)]
    [InlineData("Mr. Smith goes to Washington", false)]
    public void Placeholder_titles_fall_back_to_the_file_name(string? title, bool placeholder) =>
        Assert.Equal(placeholder, PdfProcessor.IsPlaceholderTitle(title));

    [Fact]
    public void Excerpt_skips_headings_and_cuts_at_a_word_boundary()
    {
        var longText = string.Join(' ', Enumerable.Repeat("lighthouse", 60));
        var chapters = new[]
        {
            new ProcessedChapter(1, [ContentBlock.Heading("Chapter One"), ContentBlock.Paragraph("Short start.")], []),
            new ProcessedChapter(2, [ContentBlock.Paragraph(longText)], []),
        };

        var excerpt = Bib.Api.Processing.BookConversionService.BuildExcerpt(chapters)!;

        Assert.StartsWith("Short start. lighthouse", excerpt);
        Assert.EndsWith("lighthouse…", excerpt);
        Assert.True(excerpt.Length <= Bib.Api.Processing.BookConversionService.ExcerptLength + 1);
        Assert.Null(Bib.Api.Processing.BookConversionService.BuildExcerpt([new ProcessedChapter(1, [], [])]));
    }

    [Fact]
    public void Joining_lines_records_removed_hyphens()
    {
        var removed = new List<Removal>();

        var text = PdfProcessor.JoinLines(["A sim-", "ple test", "", "of lines."], removed);

        Assert.Equal("A simple test of lines.", text);
        Assert.Equal([new Removal(RemovalKinds.Hyphen, "-")], removed);
    }

    [Fact]
    public void Order_similarity_is_lcs_ratio()
    {
        Assert.Equal(1, ConversionVerifier.OrderSimilarity(["a", "b", "c"], ["a", "b", "c"]));
        Assert.Equal(2.0 / 3, ConversionVerifier.OrderSimilarity(["a", "b", "c"], ["b", "c", "a"]), 6);
        Assert.Equal(1, ConversionVerifier.OrderSimilarity([], []));
    }
}

public sealed class ImageInfoTests
{
    [Fact]
    public void Reads_png_dimensions_and_rejects_truncated_files()
    {
        var png = TestImages.EncodePng(TestImages.Pattern(17, 9, 1));

        Assert.Equal(new ImageDimensions("png", 17, 9), ImageInfo.Read(png));
        Assert.Null(ImageInfo.Read(png[..(png.Length - 20)]));
    }

    [Fact]
    public void Reads_jpeg_dimensions() =>
        Assert.Equal(new ImageDimensions("jpg", 64, 48), ImageInfo.Read(TestImages.SampleJpeg()));

    [Fact]
    public void Rejects_unknown_formats() => Assert.Null(ImageInfo.Read("GIF89a......"u8));

    [Fact]
    public void Png_encoder_round_trips_pixels()
    {
        var pattern = TestImages.Pattern(31, 13, 9);

        Assert.Equal(pattern.Rgb, TestImages.DecodePng(TestImages.EncodePng(pattern)).Rgb);
    }

    [Fact]
    public void Image_file_name_pattern_rejects_traversal()
    {
        Assert.Matches(ConversionVerifier.ImageNameRegex(), "p12-3.png");
        Assert.Matches(ConversionVerifier.ImageNameRegex(), "p1-page.png");
        Assert.DoesNotMatch(ConversionVerifier.ImageNameRegex(), "../p1-1.png");
        Assert.DoesNotMatch(ConversionVerifier.ImageNameRegex(), "p1-1.png/../../source.pdf");
        Assert.DoesNotMatch(ConversionVerifier.ImageNameRegex(), "source.pdf");
    }
}
