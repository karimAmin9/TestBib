using System.Security.Cryptography;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Tokens;

namespace Bib.Conversion;

public sealed record ExtractedImage(byte[] Bytes, string Extension);

/// <summary>Turns a PDF image into a browser-displayable file (JPEG passthrough or PNG).</summary>
public static class ImageExtractor
{
    public static ExtractedImage? TryExtract(IPdfImage image)
    {
        if (IsPlainJpeg(image))
        {
            var raw = image.RawMemory.ToArray();
            if (ImageInfo.Read(raw) is { Format: "jpg" })
            {
                return new ExtractedImage(raw, "jpg");
            }
        }

        try
        {
            if (image.TryGetPng(out var png) && png is { Length: > 0 } && ImageInfo.Read(png) is not null)
            {
                return new ExtractedImage(png, "png");
            }
        }
        catch (Exception)
        {
            // Unsupported encodings (JBIG2, JPX, exotic color spaces) fall back to page rendering.
        }

        return null;
    }

    public static string Sha256Hex(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static bool IsPlainJpeg(IPdfImage image)
    {
        if (image.IsImageMask || !image.ImageDictionary.TryGet(NameToken.Filter, out var filter))
        {
            return false;
        }

        return filter switch
        {
            NameToken name => name.Equals(NameToken.DctDecode) || name.Equals(NameToken.DctDecodeAbbreviation),
            ArrayToken { Length: 1 } array => array.Data[0] is NameToken n &&
                                              (n.Equals(NameToken.DctDecode) || n.Equals(NameToken.DctDecodeAbbreviation)),
            _ => false,
        };
    }
}
