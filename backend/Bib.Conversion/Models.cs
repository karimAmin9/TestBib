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

    public static ContentBlock Paragraph(string text) => new() { Type = BlockTypes.Paragraph, Text = text };

    public static ContentBlock Heading(string text) => new() { Type = BlockTypes.Heading, Text = text };
}

public static class RemovalKinds
{
    public const string PageNumber = "page-number";
    public const string Hyphen = "hyphen";
}

/// <summary>Something the processor deliberately left out of the output, so the verifier can account for it.</summary>
public sealed record Removal(string Kind, string Text);

public sealed record ProcessedChapter(int Number, IReadOnlyList<ContentBlock> Blocks, IReadOnlyList<Removal> Removed);

public sealed record ProcessedBook(
    string Title,
    string? Author,
    int PageCount,
    IReadOnlyList<ProcessedChapter> Chapters,
    byte[]? CoverPng);

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
internal sealed partial class ConversionJsonContext : JsonSerializerContext;
