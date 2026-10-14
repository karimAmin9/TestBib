using Microsoft.AspNetCore.Identity;

namespace Bib.Api.Data;

public sealed class AppUser : IdentityUser;

public enum BookStatus
{
    Processing,
    Ready,
    Failed,
}

public enum VerificationStatus
{
    None,
    Verified,
    Warnings,
    Differences,
}

public sealed class Book
{
    public Guid Id { get; set; }

    public required string OwnerId { get; set; }

    public required string Title { get; set; }

    public string? Author { get; set; }

    public required string OriginalFileName { get; set; }

    public int PageCount { get; set; }

    public BookStatus Status { get; set; }

    /// <summary>Readable reason when <see cref="Status"/> is <see cref="BookStatus.Failed"/>.</summary>
    public string? Error { get; set; }

    public VerificationStatus VerificationStatus { get; set; }

    public int PagesWithIssues { get; set; }

    /// <summary>The full <c>VerificationReport</c> (jsonb).</summary>
    public string? VerificationJson { get; set; }

    public string? Excerpt { get; set; }

    public bool HasCover { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}

/// <summary>One PDF page ("Page N"). Content is stored as jsonb blocks, see ADR-003.</summary>
public sealed class Chapter
{
    public long Id { get; set; }

    public Guid BookId { get; set; }

    public int Number { get; set; }

    public required string Title { get; set; }

    /// <summary><c>List&lt;ContentBlock&gt;</c> (jsonb).</summary>
    public required string BlocksJson { get; set; }

    /// <summary><c>List&lt;Removal&gt;</c>: what the processor deliberately dropped or joined (jsonb).</summary>
    public required string RemovedJson { get; set; }
}

public sealed class ReadingProgress
{
    public required string UserId { get; set; }

    public Guid BookId { get; set; }

    public int ChapterNumber { get; set; }

    public double ScrollPercent { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }
}

public static class BookQueryExtensions
{
    /// <summary>Every book endpoint goes through this, so other users' books are simply not found.</summary>
    public static IQueryable<Book> OwnedBy(this IQueryable<Book> books, string userId) =>
        books.Where(b => b.OwnerId == userId);
}
