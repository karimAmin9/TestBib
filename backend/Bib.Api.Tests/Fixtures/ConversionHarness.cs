using Bib.Api.Conversion;

namespace Bib.Api.Tests.Fixtures;

/// <summary>Runs processor + verifier against a temporary image directory.</summary>
public sealed class ConversionHarness : IDisposable
{
    public ConversionHarness()
    {
        ImageDir = Path.Combine(Path.GetTempPath(), "bib-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(ImageDir);
    }

    public string ImageDir { get; }

    public PdfProcessor Processor { get; } = new(new DocnetPageRenderer());

    public ConversionVerifier Verifier { get; } = new();

    public ProcessedBook Process(byte[] pdf, string fallbackTitle = "fallback") =>
        Processor.Process(pdf, ImageDir, fallbackTitle);

    public VerificationReport Verify(byte[] pdf, IReadOnlyList<ProcessedChapter> chapters) =>
        Verifier.Verify(pdf, chapters, ImageDir);

    public byte[] ReadImage(string src) => File.ReadAllBytes(Path.Combine(ImageDir, src));

    public static IReadOnlyList<string> Paragraphs(ProcessedChapter chapter) =>
        chapter.Blocks.Where(b => b.Type == BlockTypes.Paragraph).Select(b => b.Text!).ToList();

    public static IReadOnlyList<string> Words(ProcessedChapter chapter) =>
        Paragraphs(chapter).SelectMany(TextNormalizer.Words).ToList();

    /// <summary>"p" / "img" sequence, to assert relative block positions.</summary>
    public static string Shape(ProcessedChapter chapter) => string.Join(",", chapter.Blocks.Select(b => b.Type));

    public void Dispose()
    {
        try
        {
            Directory.Delete(ImageDir, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
