using System.Text.Json;
using System.Text.Json.Serialization;
using Bib.Conversion;

namespace Bib.Api.Tests;

/// <summary>
/// Chapters, removals and reports are stored as JSON. The trim-safe (source-generated) serializer must write exactly
/// what the earlier reflection-based one wrote, so rows that are already stored stay readable without a migration.
/// </summary>
public sealed class ConversionJsonTests
{
    // The options ConversionJson used before it switched to source generation.
    private static readonly JsonSerializerOptions ReflectionOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly IReadOnlyList<ContentBlock> Blocks =
    [
        ContentBlock.Heading("Chapter One"),
        ContentBlock.Paragraph("„Grüß Gott“, said the ﬁsherman."),
        new() { Type = BlockTypes.Image, Src = "p1-1.jpg", W = 640, H = 480, Sha256 = new string('a', 64) },
        new() { Type = BlockTypes.Image, Src = "p1-page.png", W = 1190, H = 1684, Sha256 = new string('b', 64), Rendered = true },
    ];

    private static readonly IReadOnlyList<Removal> Removed =
        [new(RemovalKinds.PageNumber, "12"), new(RemovalKinds.Hyphen, "-")];

    private static readonly VerificationReport Report = new()
    {
        Status = PageStatus.Warning,
        PageCount = 2,
        PagesPassed = 1,
        PagesWithWarnings = 1,
        Notes = ["1 page with notes"],
        Pages =
        [
            new() { Page = 1, Status = PageStatus.Pass, SourceCharacters = 120, OutputCharacters = 120, SourceImages = 1, OutputImages = 1 },
            new()
            {
                Page = 2,
                Status = PageStatus.Warning,
                MissingWords = ["lighthouse"],
                ExtraWords = ["light", "house"],
                OrderSimilarity = 0.9731,
                Notes = ["columns"],
            },
        ],
    };

    [Fact]
    public void Writes_exactly_what_the_reflection_serializer_wrote()
    {
        Assert.Equal(JsonSerializer.Serialize(Blocks, ReflectionOptions), ConversionJson.Serialize(Blocks));
        Assert.Equal(JsonSerializer.Serialize(Removed, ReflectionOptions), ConversionJson.Serialize(Removed));
        Assert.Equal(JsonSerializer.Serialize(Report, ReflectionOptions), ConversionJson.Serialize(Report));
    }

    [Fact]
    public void Reads_back_what_it_wrote()
    {
        Assert.Equal(Blocks, ConversionJson.Deserialize<List<ContentBlock>>(ConversionJson.Serialize(Blocks)));
        Assert.Equal(Removed, ConversionJson.Deserialize<List<Removal>>(ConversionJson.Serialize(Removed)));
        var report = ConversionJson.Deserialize<VerificationReport>(ConversionJson.Serialize(Report));
        Assert.Equal(ConversionJson.Serialize(Report), ConversionJson.Serialize(report));
    }
}
