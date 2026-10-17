using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Bib.Conversion;

public static class BlockTypes
{
    public const string Paragraph = "p";
    public const string Heading = "h";
    public const string Image = "img";

    public static bool IsText(string type) => type is Paragraph or Heading;
}

/// <summary>One unit of chapter content: a paragraph of text or an image.</summary>
public sealed record ContentBlock
{
    public required string Type { get; init; }
    public string? Text { get; init; }

    /// <summary>Image file name inside the book's image directory.</summary>
    public string? Src { get; init; }

    public int? W { get; init; }
    public int? H { get; init; }

    /// <summary>SHA-256 (hex) of the image file bytes at the time they were written.</summary>
    public string? Sha256 { get; init; }

    /// <summary>True when the image could not be extracted and was rendered from the page instead.</summary>
    public bool? Rendered { get; init; }

    /// <summary>Stable id "p{page}-b{seq}", unique within the book.</summary>
    public string? Id { get; init; }

    /// <summary>The PDF page the block comes from.</summary>
    public int? Page { get; init; }

    /// <summary>Position in the page's reading order (0-based). The verifier restores this order.</summary>
    public int? Seq { get; init; }

    /// <summary>Where and how the block is set on the page, for organizing the book into chapters.</summary>
    public BlockLayout? Layout { get; init; }

    // Set when a book is organized into chapters (frontend). They only change how the text is presented:
    // the verifier checks the original text, regrouped by Page and Seq.

    /// <summary>"body", "heading", "caption" or "other".</summary>
    public string? Role { get; init; }

    /// <summary>Continues the previous text block (a paragraph running across a page break).</summary>
    public bool? Cont { get; init; }

    /// <summary>Blocks sharing a figure id form one figure: images and their captions.</summary>
    public string? Figure { get; init; }

    /// <summary>Scan-error corrections shown instead of the original characters; the text itself stays original.</summary>
    public IReadOnlyList<TextFix>? Fixes { get; init; }

    public static ContentBlock Paragraph(string text) => new() { Type = BlockTypes.Paragraph, Text = text };

    public static ContentBlock Heading(string text) => new() { Type = BlockTypes.Heading, Text = text };
}

/// <summary>Position (points, origin top left of the page) and type face of a block.</summary>
public sealed record BlockLayout(double X, double Y, double W, double H, double FontSize, bool Bold, bool Italic);

/// <summary>Replace <see cref="Len"/> characters at <see cref="At"/> of the block text with <see cref="To"/>.</summary>
public sealed record TextFix(int At, int Len, string To);

public static class RemovalKinds
{
    public const string PageNumber = "page-number";
    public const string Hyphen = "hyphen";

    /// <summary>Page furniture left out when organizing a book, e.g. a running header.</summary>
    public const string Artifact = "artifact";
}

/// <summary>Something the processor deliberately left out of the output, so the verifier can account for it.</summary>
public sealed record Removal(string Kind, string Text);

/// <summary>One PDF page. <see cref="Width"/>/<see cref="Height"/> in points (0 when unknown).</summary>
public sealed record ProcessedChapter(
    int Number,
    IReadOnlyList<ContentBlock> Blocks,
    IReadOnlyList<Removal> Removed,
    double Width = 0,
    double Height = 0);

/// <summary>An entry of the PDF's own outline (bookmarks).</summary>
public sealed record OutlineEntry(string Title, int Page, int Level);

public sealed record ProcessedBook(
    string Title,
    string? Author,
    int PageCount,
    IReadOnlyList<ProcessedChapter> Chapters,
    byte[]? CoverPng,
    IReadOnlyList<OutlineEntry>? Outline = null);

/// <summary>A removal made while organizing the book, attributed to its page.</summary>
public sealed record PageRemoval(int Page, string Kind, string Text);

/// <summary>A book organized into chapters, as stored, for <see cref="ConversionVerifier.VerifyAssembled"/>.</summary>
public sealed record AssembledBook(
    int PageCount,
    IReadOnlyList<IReadOnlyList<ContentBlock>> Chapters,
    IReadOnlyList<PageRemoval> Removed);

public sealed class PdfProcessingException(string message, Exception? inner = null) : Exception(message, inner);

public static class PageStatus
{
    public const string Pass = "Pass";
    public const string Warning = "Warning";
    public const string Fail = "Fail";
}

public sealed record PageVerification
{
    public required int Page { get; init; }
    public required string Status { get; init; }
    public int SourceCharacters { get; init; }
    public int OutputCharacters { get; init; }
    public string MissingCharacters { get; init; } = "";
    public string ExtraCharacters { get; init; } = "";
    public IReadOnlyList<string> MissingWords { get; init; } = [];
    public IReadOnlyList<string> ExtraWords { get; init; } = [];
    public double OrderSimilarity { get; init; } = 1;
    public int SourceImages { get; init; }
    public int OutputImages { get; init; }
    public IReadOnlyList<string> ImageIssues { get; init; } = [];
    public IReadOnlyList<string> Notes { get; init; } = [];
}

public sealed record VerificationReport
{
    public required string Status { get; init; }
    public int PageCount { get; init; }
    public int PagesPassed { get; init; }
    public int PagesWithWarnings { get; init; }
    public int PagesFailed { get; init; }
    public IReadOnlyList<string> Notes { get; init; } = [];
    public required IReadOnlyList<PageVerification> Pages { get; init; }
}

public static class ConversionJson
{
    public static readonly JsonSerializerOptions Options = ConversionJsonContext.Default.Options;

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, TypeInfo<T>());

    public static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize(json, TypeInfo<T>()) ?? throw new InvalidOperationException("Invalid stored JSON.");

    private static JsonTypeInfo<T> TypeInfo<T>() => (JsonTypeInfo<T>)Options.GetTypeInfo(typeof(T));
}

/// <summary>
/// Source-generated (trim-safe) JSON metadata for everything stored as JSON; register new stored types here.
/// Reflection-based serialization breaks in the trimmed browser build.
/// </summary>
[JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(IReadOnlyList<ContentBlock>))]
[JsonSerializable(typeof(List<ContentBlock>))]
[JsonSerializable(typeof(IReadOnlyList<Removal>))]
[JsonSerializable(typeof(List<Removal>))]
[JsonSerializable(typeof(IReadOnlyList<ProcessedChapter>))]
[JsonSerializable(typeof(VerificationReport))]
[JsonSerializable(typeof(PageVerification))]
[JsonSerializable(typeof(AssembledBook))]
internal sealed partial class ConversionJsonContext : JsonSerializerContext;
