using Bib.Api.Conversion;
using Bib.Api.Data;
using Bib.Api.Storage;
using Microsoft.EntityFrameworkCore;

namespace Bib.Api.Processing;

/// <summary>Runs one book through processing and proof-reading and stores the result.</summary>
public sealed class BookConversionService(
    AppDbContext db,
    BookStorage storage,
    PdfProcessor processor,
    ConversionVerifier verifier,
    ILogger<BookConversionService> logger)
{
    public async Task ConvertAsync(Guid bookId, CancellationToken ct)
    {
        var book = await db.Books.SingleOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
        {
            return; // deleted while queued
        }

        using var scope = logger.BeginScope(new Dictionary<string, object> { ["BookId"] = bookId });
        try
        {
            var pdf = await File.ReadAllBytesAsync(storage.SourcePath(bookId), ct);
            var imagesDir = storage.ImagesDir(bookId);

            await db.Chapters.Where(c => c.BookId == bookId).ExecuteDeleteAsync(ct);
            storage.ResetOutput(bookId);

            var processed = processor.Process(pdf, imagesDir, Path.GetFileNameWithoutExtension(book.OriginalFileName));
            db.Chapters.AddRange(processed.Chapters.Select(c => new Chapter
            {
                BookId = bookId,
                Number = c.Number,
                Title = PdfProcessor.ChapterTitle(c.Number),
                BlocksJson = ConversionJson.Serialize(c.Blocks),
                RemovedJson = ConversionJson.Serialize(c.Removed),
            }));

            if (processed.CoverPng is not null)
            {
                await File.WriteAllBytesAsync(storage.CoverPath(bookId), processed.CoverPng, ct);
            }

            book.Title = processed.Title;
            book.Author ??= processed.Author;
            book.PageCount = processed.PageCount;
            book.HasCover = processed.CoverPng is not null;
            await db.SaveChangesAsync(ct);

            // Proof-read what was actually stored, not the in-memory result.
            var stored = await db.Chapters.AsNoTracking()
                .Where(c => c.BookId == bookId)
                .OrderBy(c => c.Number)
                .Select(c => new { c.Number, c.BlocksJson, c.RemovedJson })
                .ToListAsync(ct);
            var chapters = stored.Select(c => new ProcessedChapter(
                c.Number,
                ConversionJson.Deserialize<List<ContentBlock>>(c.BlocksJson),
                ConversionJson.Deserialize<List<Removal>>(c.RemovedJson))).ToList();

            var report = verifier.Verify(pdf, chapters, imagesDir);
            book.VerificationJson = ConversionJson.Serialize(report);
            book.PagesWithIssues = report.PagesFailed + report.PagesWithWarnings;
            book.VerificationStatus = report.Status switch
            {
                PageStatus.Pass => VerificationStatus.Verified,
                PageStatus.Warning => VerificationStatus.Warnings,
                _ => VerificationStatus.Differences,
            };
            book.Status = BookStatus.Ready;
            book.Error = null;
            await db.SaveChangesAsync(ct);

            logger.LogInformation(
                "Converted {Pages} pages; verification {Status} ({Issues} pages with issues)",
                processed.PageCount, report.Status, book.PagesWithIssues);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (DbUpdateConcurrencyException)
        {
            logger.LogInformation("Book was deleted during conversion");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Conversion failed");
            await MarkFailedAsync(bookId, ex is PdfProcessingException ? ex.Message : "Unexpected error while converting this PDF.");
        }
    }

    private async Task MarkFailedAsync(Guid bookId, string message)
    {
        db.ChangeTracker.Clear();
        await db.Books.Where(b => b.Id == bookId).ExecuteUpdateAsync(s => s
            .SetProperty(b => b.Status, BookStatus.Failed)
            .SetProperty(b => b.Error, message));
    }
}
