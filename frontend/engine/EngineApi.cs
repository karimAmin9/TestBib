using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Text.Json.Serialization;
using Bib.Conversion;

namespace Bib.Engine;

/// <summary>
/// The engine's JavaScript API, called by engine-worker.js. One book at a time: <see cref="ProcessAsync"/>, then
/// <see cref="ReadCover"/> / <see cref="ReadImage"/>, then <see cref="Verify"/>, then <see cref="Reset"/>.
/// Image files live in the in-memory file system until <see cref="Reset"/>.
/// </summary>
public static partial class EngineApi
{
    private static Job? _job;

    /// <summary>Converts the PDF and returns the book (<see cref="EngineBook"/>) as JSON.</summary>
    [JSExport]
    public static async Task<string> ProcessAsync(byte[] pdf, string fileName)
    {
        Reset();
        var imageDir = Path.Combine(Path.GetTempPath(), "bib-" + Guid.NewGuid().ToString("N"));
        try
        {
            var book = await new PdfProcessor(new JsPageRenderer()).ProcessAsync(
                pdf,
                imageDir,
                Path.GetFileNameWithoutExtension(fileName),
                (n, total) => BrowserHost.Progress("processing", n, total));

            // Verify what gets stored (the JSON round trip), like the server verifies the stored chapters.
            var stored = book.Chapters.Select(c => new ProcessedChapter(
                c.Number,
                ConversionJson.Deserialize<List<ContentBlock>>(ConversionJson.Serialize(c.Blocks)),
                ConversionJson.Deserialize<List<Removal>>(ConversionJson.Serialize(c.Removed)))).ToList();
            _job = new Job(pdf, imageDir, stored, book.CoverPng);

            var chapters = stored.Select(c => new EngineChapter(c.Number, PdfProcessor.ChapterTitle(c.Number), c.Blocks, c.Removed));
            return JsonSerializer.Serialize(
                new EngineBook(book.Title, book.Author, book.PageCount, book.CoverPng is not null, chapters.ToList()),
                EngineJson.Default.EngineBook);
        }
        catch (Exception ex)
        {
            DeleteDirectory(imageDir);
            if (ex is PdfProcessingException)
            {
                throw;
            }

            Console.Error.WriteLine(ex); // the browser console
            throw new PdfProcessingException("Unexpected error while converting this PDF.", ex);
        }
    }

    /// <summary>The cover as PNG; empty when the first page could not be rendered.</summary>
    [JSExport]
    public static byte[] ReadCover() => CurrentJob().Cover ?? [];

    [JSExport]
    public static byte[] ReadImage(string name)
    {
        // Names come from the blocks, but never let one escape the image directory.
        if (!ConversionVerifier.ImageNameRegex().IsMatch(name))
        {
            throw new ArgumentException($"Not an image file name: {name}", nameof(name));
        }

        return File.ReadAllBytes(Path.Combine(CurrentJob().ImageDir, name));
    }

    /// <summary>Proof-reads the converted book against the PDF; returns the <see cref="VerificationReport"/> as JSON.</summary>
    [JSExport]
    public static string Verify()
    {
        var job = CurrentJob();
        var report = new ConversionVerifier().Verify(
            job.Pdf, job.Chapters, job.ImageDir, (n, total) => BrowserHost.Progress("verifying", n, total));
        return ConversionJson.Serialize(report);
    }

    /// <summary>Releases the PDF and the image files of the current book.</summary>
    [JSExport]
    public static void Reset()
    {
        if (_job is { } job)
        {
            DeleteDirectory(job.ImageDir);
            _job = null;
        }
    }

    private static Job CurrentJob() => _job ?? throw new InvalidOperationException("No book has been converted.");

    private static void DeleteDirectory(string path)
    {
        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }
    }

    private sealed record Job(byte[] Pdf, string ImageDir, IReadOnlyList<ProcessedChapter> Chapters, byte[]? Cover);
}

public sealed record EngineBook(string Title, string? Author, int PageCount, bool HasCover, IReadOnlyList<EngineChapter> Chapters);

public sealed record EngineChapter(int Number, string Title, IReadOnlyList<ContentBlock> Blocks, IReadOnlyList<Removal> Removed);

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(EngineBook))]
internal sealed partial class EngineJson : JsonSerializerContext;
