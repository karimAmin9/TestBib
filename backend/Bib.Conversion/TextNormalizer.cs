using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Bib.Conversion;

/// <summary>
/// Text normalization shared by <see cref="PdfProcessor"/> and <see cref="ConversionVerifier"/>
/// so both sides compare text the same way.
/// </summary>
public static partial class TextNormalizer
{
    public const char SoftHyphen = '­';

    /// <summary>
    /// The NFKC implementation. .NET in the browser (WebAssembly) does not support NFKC, so the browser host sets this
    /// once at startup to JavaScript's <c>String.prototype.normalize('NFKC')</c>.
    /// </summary>
    public static Func<string, string> NfkcImplementation { get; set; } = text => text.Normalize(NormalizationForm.FormKC);

    /// <summary>NFKC (splits ligatures such as "ﬁ" into "fi"). ASCII is already NFKC and is returned as is.</summary>
    public static string Nfkc(string text) => Ascii.IsValid(text) ? text : NfkcImplementation(text);

    /// <summary>NFKC (splits ligatures such as "ﬁ" into "fi") with all whitespace removed.</summary>
    public static string Glyphs(string text)
    {
        var normalized = Nfkc(text);
        var sb = new StringBuilder(normalized.Length);
        foreach (var ch in normalized)
        {
            if (!char.IsWhiteSpace(ch) && ch != SoftHyphen && !char.IsControl(ch))
            {
                sb.Append(ch);
            }
        }

        return sb.ToString();
    }

    /// <summary>Splits text into NFKC-normalized, whitespace separated words.</summary>
    public static IReadOnlyList<string> Words(string text) =>
        Nfkc(text)
            .Replace(SoftHyphen.ToString(), "")
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);

    /// <summary>
    /// True when a line ending in <paramref name="lineEnd"/> followed by a line starting with
    /// <paramref name="nextStart"/> is a word broken by a hyphen ("exam-" + "ple").
    /// </summary>
    public static bool IsHyphenBreak(string lineEnd, string nextStart)
    {
        if (lineEnd.Length < 2 || nextStart.Length == 0)
        {
            return false;
        }

        var last = lineEnd[^1];
        if (last != '-' && last != SoftHyphen)
        {
            return false;
        }

        return char.IsLetter(lineEnd[^2]) && char.IsLower(nextStart[0]);
    }

    /// <summary>Joins hyphen-broken words in a word sequence, mirroring how the processor joins lines.</summary>
    public static List<string> Dehyphenate(IReadOnlyList<string> words)
    {
        var result = new List<string>(words.Count);
        for (var i = 0; i < words.Count; i++)
        {
            var word = words[i];
            while (i + 1 < words.Count && IsHyphenBreak(word, words[i + 1]))
            {
                word = word[..^1] + words[i + 1];
                i++;
            }

            result.Add(word);
        }

        return result;
    }

    /// <summary>Page-number artifacts: "12", "- 12 -", "xiv".</summary>
    public static bool LooksLikePageNumber(string text) => PageNumberRegex().IsMatch(text.Trim());

    public static string CharacterDiff(string expected, string actual)
    {
        var counts = new Dictionary<string, int>();
        foreach (var e in StringInfoElements(expected))
        {
            counts[e] = counts.GetValueOrDefault(e) + 1;
        }

        foreach (var a in StringInfoElements(actual))
        {
            counts[a] = counts.GetValueOrDefault(a) - 1;
        }

        var sb = new StringBuilder();
        foreach (var (element, count) in counts.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            for (var i = 0; i < count; i++)
            {
                sb.Append(element);
            }
        }

        return sb.ToString();
    }

    private static IEnumerable<string> StringInfoElements(string s)
    {
        var e = StringInfo.GetTextElementEnumerator(s);
        while (e.MoveNext())
        {
            yield return (string)e.Current;
        }
    }

    [GeneratedRegex(@"^(-\s*)?(\d{1,4}|[ivxlcdm]{1,7}|[IVXLCDM]{1,7})(\s*-)?$")]
    private static partial Regex PageNumberRegex();
}
