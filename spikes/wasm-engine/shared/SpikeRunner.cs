using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Bib.Api.Conversion;

/// <summary>Processor + verifier exactly as BookConversionService runs them, with timings and an output fingerprint.</summary>
public static class SpikeRunner
{
    public static string Run(byte[] pdf, string workDir)
    {
        var imageDir = Path.Combine(workDir, "spike-" + Guid.NewGuid().ToString("N"));
        try
        {
            var total = Stopwatch.StartNew();
            var sw = Stopwatch.StartNew();
            var book = new PdfProcessor(new BlankPageRenderer()).Process(pdf, imageDir, "spike");
            var processMs = sw.ElapsedMilliseconds;

            // Verify what would be stored (JSON round trip), like BookConversionService does.
            sw.Restart();
            var stored = book.Chapters.Select(c => new ProcessedChapter(
                c.Number,
                ConversionJson.Deserialize<List<ContentBlock>>(ConversionJson.Serialize(c.Blocks)),
                ConversionJson.Deserialize<List<Removal>>(ConversionJson.Serialize(c.Removed)))).ToList();
            var report = new ConversionVerifier().Verify(pdf, stored, imageDir);
            var verifyMs = sw.ElapsedMilliseconds;

            // Fingerprint of everything the app would store: chapters JSON + every image file.
            var fingerprint = new StringBuilder(ConversionJson.Serialize(book.Chapters));
            var files = Directory.GetFiles(imageDir).OrderBy(f => f, StringComparer.Ordinal).ToList();
            long imageBytes = 0;
            foreach (var file in files)
            {
                var bytes = File.ReadAllBytes(file);
                imageBytes += bytes.Length;
                fingerprint.Append('|').Append(Path.GetFileName(file)).Append(':').Append(Convert.ToHexStringLower(SHA256.HashData(bytes)));
            }

            var gc = GC.GetGCMemoryInfo();
            return Json(w =>
            {
                w.WriteBoolean("ok", true);
                w.WriteNumber("pages", book.PageCount);
                w.WriteNumber("blocks", book.Chapters.Sum(c => c.Blocks.Count));
                w.WriteNumber("textChars", book.Chapters.Sum(c => c.Blocks.Sum(b => b.Text?.Length ?? 0)));
                w.WriteNumber("images", files.Count);
                w.WriteNumber("imageMb", Math.Round(imageBytes / 1048576.0, 1));
                w.WriteBoolean("cover", book.CoverPng is not null);
                w.WriteString("status", report.Status);
                w.WriteNumber("pagesFailed", report.PagesFailed);
                w.WriteNumber("pagesWithWarnings", report.PagesWithWarnings);
                w.WriteNumber("processMs", processMs);
                w.WriteNumber("verifyMs", verifyMs);
                w.WriteNumber("totalMs", total.ElapsedMilliseconds);
                w.WriteString("fingerprint", Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(fingerprint.ToString()))));
                w.WriteNumber("gcHeapMb", Math.Round(GC.GetTotalMemory(false) / 1048576.0, 1));
                w.WriteNumber("gcCommittedMb", Math.Round(gc.TotalCommittedBytes / 1048576.0, 1));
            });
        }
        catch (Exception ex)
        {
            return Json(w =>
            {
                w.WriteBoolean("ok", false);
                w.WriteString("error", ex.ToString());
            });
        }
        finally
        {
            try
            {
                Directory.Delete(imageDir, recursive: true);
            }
            catch (IOException)
            {
            }
        }
    }

    // Utf8JsonWriter needs no reflection, so the result survives trimming.
    private static string Json(Action<Utf8JsonWriter> write)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            w.WriteStartObject();
            write(w);
            w.WriteEndObject();
        }

        return Encoding.UTF8.GetString(stream.ToArray());
    }
}
