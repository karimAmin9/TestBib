using System.Security.Claims;
using Bib.Api.Conversion;
using Bib.Api.Data;
using Bib.Api.Processing;
using Bib.Api.Storage;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Bib.Api.Books;

public static class BookEndpoints
{
    public const long MaxUploadBytes = 100L * 1024 * 1024;

    public static void MapBookEndpoints(this IEndpointRouteBuilder app)
    {
        var books = app.MapGroup("/api/books").RequireAuthorization();

        books.MapGet("/", ListAsync);
        books.MapPost("/", UploadAsync)
            .DisableAntiforgery() // cookie is SameSite=Strict; see ADR-002
            .RequireRateLimiting(RateLimits.Upload)
            .WithMetadata(new RequestSizeLimitAttribute(MaxUploadBytes + 1024 * 1024))
            .WithMetadata(new RequestFormLimitsAttribute { MultipartBodyLengthLimit = MaxUploadBytes + 1024 * 1024 });
        books.MapGet("/{id:guid}", GetAsync);
        books.MapPatch("/{id:guid}", UpdateAsync);
        books.MapDelete("/{id:guid}", DeleteAsync);
        books.MapGet("/{id:guid}/chapters/{number:int}", GetChapterAsync);
        books.MapGet("/{id:guid}/verification", GetVerificationAsync);
        books.MapGet("/{id:guid}/cover", GetCoverAsync);
        books.MapGet("/{id:guid}/images/{file}", GetImageAsync);
        books.MapPut("/{id:guid}/progress", SaveProgressAsync);
    }

    private static string UserId(ClaimsPrincipal user) =>
        user.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new InvalidOperationException("No user id.");

    private static async Task<Ok<List<BookSummaryDto>>> ListAsync(ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = UserId(user);
        var rows = await db.Books.AsNoTracking().OwnedBy(userId)
            .OrderByDescending(b => b.CreatedAt)
            .Select(b => new
            {
                Book = b,
                Progress = db.ReadingProgress.FirstOrDefault(p => p.UserId == userId && p.BookId == b.Id),
            })
            .ToListAsync(ct);
        return TypedResults.Ok(rows.Select(r => ToSummary(r.Book, r.Progress)).ToList());
    }

    private static async Task<Results<Accepted<BookSummaryDto>, ProblemHttpResult>> UploadAsync(
        IFormFile? file,
        ClaimsPrincipal user,
        AppDbContext db,
        BookStorage storage,
        ProcessingQueue queue,
        TimeProvider time,
        CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            return Problem("Please choose a PDF file to upload.");
        }

        if (file.Length > MaxUploadBytes)
        {
            return Problem($"The file is larger than {MaxUploadBytes / 1024 / 1024} MB.", StatusCodes.Status413PayloadTooLarge);
        }

        await using (var probe = file.OpenReadStream())
        {
            var header = new byte[5];
            var read = await probe.ReadAtLeastAsync(header, header.Length, throwOnEndOfStream: false, ct);
            if (read < 5 || !header.AsSpan().SequenceEqual("%PDF-"u8))
            {
                return Problem("The file is not a PDF.", StatusCodes.Status415UnsupportedMediaType);
            }
        }

        var fileName = Path.GetFileName(file.FileName);
        if (fileName.Length > 300)
        {
            fileName = fileName[..300];
        }

        var book = new Book
        {
            Id = Guid.NewGuid(),
            OwnerId = UserId(user),
            Title = TitleFromFileName(fileName),
            OriginalFileName = fileName,
            Status = BookStatus.Processing,
            CreatedAt = time.GetUtcNow(),
        };

        Directory.CreateDirectory(storage.BookDir(book.Id));
        await using (var target = File.Create(storage.SourcePath(book.Id)))
        {
            await file.CopyToAsync(target, ct);
        }

        db.Books.Add(book);
        await db.SaveChangesAsync(ct);
        queue.Enqueue(book.Id);

        return TypedResults.Accepted($"/api/books/{book.Id}", ToSummary(book, null));
    }

    private static async Task<Results<Ok<BookDetailDto>, NotFound>> GetAsync(
        Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var userId = UserId(user);
        var book = await db.Books.AsNoTracking().OwnedBy(userId).SingleOrDefaultAsync(b => b.Id == id, ct);
        if (book is null)
        {
            return TypedResults.NotFound();
        }

        var progress = await db.ReadingProgress.AsNoTracking()
            .SingleOrDefaultAsync(p => p.UserId == userId && p.BookId == id, ct);
        var pageStatus = ReadReport(book)?.Pages.ToDictionary(p => p.Page, p => p.Status) ?? [];
        var chapters = await db.Chapters.AsNoTracking().Where(c => c.BookId == id).OrderBy(c => c.Number)
            .Select(c => new { c.Number, c.Title }).ToListAsync(ct);

        return TypedResults.Ok(new BookDetailDto(
            ToSummary(book, progress),
            chapters.Select(c => new ChapterRefDto(c.Number, c.Title, pageStatus.GetValueOrDefault(c.Number))).ToList()));
    }

    private static async Task<Results<Ok<BookSummaryDto>, NotFound, ProblemHttpResult>> UpdateAsync(
        Guid id, UpdateBookRequest request, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var book = await db.Books.OwnedBy(UserId(user)).SingleOrDefaultAsync(b => b.Id == id, ct);
        if (book is null)
        {
            return TypedResults.NotFound();
        }

        if (request.Title is not null)
        {
            var title = request.Title.Trim();
            if (title.Length is 0 or > 300)
            {
                return Problem("The title must be between 1 and 300 characters.");
            }

            book.Title = title;
        }

        if (request.Author is not null)
        {
            var author = request.Author.Trim();
            if (author.Length > 300)
            {
                return Problem("The author must be at most 300 characters.");
            }

            book.Author = author.Length == 0 ? null : author;
        }

        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(ToSummary(book, null));
    }

    private static async Task<Results<NoContent, NotFound>> DeleteAsync(
        Guid id, ClaimsPrincipal user, AppDbContext db, BookStorage storage, CancellationToken ct)
    {
        var deleted = await db.Books.OwnedBy(UserId(user)).Where(b => b.Id == id).ExecuteDeleteAsync(ct);
        if (deleted == 0)
        {
            return TypedResults.NotFound();
        }

        storage.DeleteBook(id);
        return TypedResults.NoContent();
    }

    private static async Task<Results<Ok<ChapterDto>, NotFound>> GetChapterAsync(
        Guid id, int number, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var book = await db.Books.AsNoTracking().OwnedBy(UserId(user))
            .Where(b => b.Id == id && b.Status == BookStatus.Ready)
            .Select(b => new { b.PageCount, b.VerificationJson })
            .SingleOrDefaultAsync(ct);
        if (book is null)
        {
            return TypedResults.NotFound();
        }

        var chapter = await db.Chapters.AsNoTracking().SingleOrDefaultAsync(c => c.BookId == id && c.Number == number, ct);
        if (chapter is null)
        {
            return TypedResults.NotFound();
        }

        var verification = book.VerificationJson is null
            ? null
            : ConversionJson.Deserialize<VerificationReport>(book.VerificationJson).Pages.FirstOrDefault(p => p.Page == number);

        return TypedResults.Ok(new ChapterDto(
            chapter.Number,
            chapter.Title,
            book.PageCount,
            number > 1 ? number - 1 : null,
            number < book.PageCount ? number + 1 : null,
            ConversionJson.Deserialize<List<ContentBlock>>(chapter.BlocksJson),
            verification));
    }

    private static async Task<Results<Ok<VerificationReport>, NotFound>> GetVerificationAsync(
        Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct)
    {
        var book = await db.Books.AsNoTracking().OwnedBy(UserId(user)).SingleOrDefaultAsync(b => b.Id == id, ct);
        var report = book is null ? null : ReadReport(book);
        return report is null ? TypedResults.NotFound() : TypedResults.Ok(report);
    }

    private static async Task<Results<PhysicalFileHttpResult, NotFound>> GetCoverAsync(
        Guid id, ClaimsPrincipal user, AppDbContext db, BookStorage storage, HttpContext http, CancellationToken ct)
    {
        if (!await db.Books.OwnedBy(UserId(user)).AnyAsync(b => b.Id == id && b.HasCover, ct))
        {
            return TypedResults.NotFound();
        }

        var path = storage.CoverPath(id);
        if (!File.Exists(path))
        {
            return TypedResults.NotFound();
        }

        http.Response.Headers.CacheControl = "private, max-age=3600";
        return TypedResults.PhysicalFile(path, "image/png");
    }

    private static async Task<Results<PhysicalFileHttpResult, NotFound>> GetImageAsync(
        Guid id, string file, ClaimsPrincipal user, AppDbContext db, BookStorage storage, HttpContext http, CancellationToken ct)
    {
        // The strict pattern makes path traversal impossible.
        var match = ConversionVerifier.ImageNameRegex().Match(file);
        if (!match.Success || !await db.Books.OwnedBy(UserId(user)).AnyAsync(b => b.Id == id, ct))
        {
            return TypedResults.NotFound();
        }

        var path = Path.Combine(storage.ImagesDir(id), file);
        if (!File.Exists(path))
        {
            return TypedResults.NotFound();
        }

        http.Response.Headers.CacheControl = "private, max-age=86400, immutable";
        return TypedResults.PhysicalFile(path, file.EndsWith(".jpg", StringComparison.Ordinal) ? "image/jpeg" : "image/png");
    }

    private static async Task<Results<NoContent, NotFound, ProblemHttpResult>> SaveProgressAsync(
        Guid id, SaveProgressRequest request, ClaimsPrincipal user, AppDbContext db, TimeProvider time, CancellationToken ct)
    {
        var userId = UserId(user);
        var book = await db.Books.AsNoTracking().OwnedBy(userId).Where(b => b.Id == id)
            .Select(b => new { b.PageCount }).SingleOrDefaultAsync(ct);
        if (book is null)
        {
            return TypedResults.NotFound();
        }

        if (request.ChapterNumber < 1 || request.ChapterNumber > book.PageCount ||
            !double.IsFinite(request.ScrollPercent) || request.ScrollPercent is < 0 or > 100)
        {
            return Problem("Invalid reading position.");
        }

        var progress = await db.ReadingProgress.SingleOrDefaultAsync(p => p.UserId == userId && p.BookId == id, ct);
        if (progress is null)
        {
            progress = new ReadingProgress { UserId = userId, BookId = id };
            db.ReadingProgress.Add(progress);
        }

        progress.ChapterNumber = request.ChapterNumber;
        progress.ScrollPercent = request.ScrollPercent;
        progress.UpdatedAt = time.GetUtcNow();
        await db.SaveChangesAsync(ct);
        return TypedResults.NoContent();
    }

    private static BookSummaryDto ToSummary(Book b, ReadingProgress? p) => new(
        b.Id,
        b.Title,
        b.Author,
        b.PageCount,
        b.Status.ToString(),
        b.Error,
        b.VerificationStatus.ToString(),
        b.PagesWithIssues,
        b.Excerpt,
        b.HasCover,
        b.CreatedAt,
        p is null ? null : new ProgressDto(p.ChapterNumber, p.ScrollPercent, p.UpdatedAt));

    private static VerificationReport? ReadReport(Book book) =>
        book.VerificationJson is null ? null : ConversionJson.Deserialize<VerificationReport>(book.VerificationJson);

    private static string TitleFromFileName(string fileName)
    {
        var title = Path.GetFileNameWithoutExtension(fileName).Replace('_', ' ').Trim();
        return title.Length == 0 ? "Untitled" : title;
    }

    private static ProblemHttpResult Problem(string detail, int status = StatusCodes.Status400BadRequest) =>
        TypedResults.Problem(detail: detail, statusCode: status);
}
