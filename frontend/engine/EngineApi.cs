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

            _job = new Job(pdf, imageDir, book.CoverPng);

            var pages = book.Chapters.Select(c => new EnginePage(c.Number, c.Width, c.Height, c.Blocks, c.Removed));
            return JsonSerializer.Serialize(
                new EngineBook(
                    book.Title, book.Author, book.PageCount, book.CoverPng is not null, pages.ToList(), book.Outline ?? []),
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

    /// <summary>
    /// Proof-reads the book as the app stores it (<see cref="AssembledBook"/> JSON: chapters of blocks, plus every
    /// removal by page) against the PDF; returns the <see cref="VerificationReport"/> as JSON.
    /// </summary>
    [JSExport]
    public static string Verify(string assembledJson)
    {
        var job = CurrentJob();
        var book = ConversionJson.Deserialize<AssembledBook>(assembledJson);
        var report = new ConversionVerifier().VerifyAssembled(
            job.Pdf, book, job.ImageDir, (n, total) => BrowserHost.Progress("verifying", n, total));
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

    private sealed record Job(byte[] Pdf, string ImageDir, byte[]? Cover);
}

public sealed record EngineBook(
    string Title,
    string? Author,
    int PageCount,
    bool HasCover,
    IReadOnlyList<EnginePage> Pages,
    IReadOnlyList<OutlineEntry> Outline);

/// <summary>One PDF page: its blocks in reading order, what was left out, and its size in points.</summary>
public sealed record EnginePage(
    int Number, double Width, double Height, IReadOnlyList<ContentBlock> Blocks, IReadOnlyList<Removal> Removed);

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(EngineBook))]
internal sealed partial class EngineJson : JsonSerializerContext;
