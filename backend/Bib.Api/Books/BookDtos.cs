using Bib.Conversion;

namespace Bib.Api.Books;

public sealed record ProgressDto(int ChapterNumber, double ScrollPercent, DateTimeOffset UpdatedAt);

public sealed record BookSummaryDto(
    Guid Id,
    string Title,
    string? Author,
    int PageCount,
    string Status,
    string? Error,
    string VerificationStatus,
    int PagesWithIssues,
    string? Excerpt,
    bool HasCover,
    DateTimeOffset CreatedAt,
    ProgressDto? Progress);

public sealed record ChapterRefDto(int Number, string Title, string? Verification);

public sealed record BookDetailDto(BookSummaryDto Book, IReadOnlyList<ChapterRefDto> Chapters);

public sealed record ChapterDto(
    int Number,
    string Title,
    int Total,
    int? Prev,
    int? Next,
    IReadOnlyList<ContentBlock> Blocks,
    PageVerification? Verification);

public sealed record UpdateBookRequest(string? Title, string? Author);

public sealed record SaveProgressRequest(int ChapterNumber, double ScrollPercent);
