using System.Buffers.Binary;
using System.IO.Compression;

namespace Bib.Api.Conversion;

public sealed record ImageDimensions(string Format, int Width, int Height);

/// <summary>Reads and sanity-checks PNG / JPEG files without an imaging library.</summary>
public static class ImageInfo
{
    /// <summary>Returns the format and pixel size, or null when the bytes are not a decodable PNG/JPEG.</summary>
    public static ImageDimensions? Read(ReadOnlySpan<byte> data)
    {
        if (IsPng(data))
        {
            return ReadPng(data);
        }

        if (data.Length > 3 && data[0] == 0xFF && data[1] == 0xD8)
        {
            return ReadJpeg(data);
        }

        return null;
    }

    public static bool IsPng(ReadOnlySpan<byte> data) =>
        data.Length > 8 && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47;

    private static ImageDimensions? ReadPng(ReadOnlySpan<byte> data)
    {
        if (data.Length < 33)
        {
            return null;
        }

        var width = BinaryPrimitives.ReadInt32BigEndian(data[16..]);
        var height = BinaryPrimitives.ReadInt32BigEndian(data[20..]);
        var bitDepth = data[24];
        var colorType = data[25];
        var interlace = data[28];

        // Fully inflate the image data and check its size to make sure the file is intact.
        using var idat = new MemoryStream();
        var pos = 8;
        while (pos + 12 <= data.Length)
        {
            var len = BinaryPrimitives.ReadInt32BigEndian(data[pos..]);
            if (len < 0 || pos + 12 + len > data.Length)
            {
                return null;
            }

            var type = System.Text.Encoding.ASCII.GetString(data.Slice(pos + 4, 4));
            if (type == "IDAT")
            {
                idat.Write(data.Slice(pos + 8, len));
            }
            else if (type == "IEND")
            {
                break;
            }

            pos += 12 + len;
        }

        try
        {
            idat.Position = 0;
            using var z = new ZLibStream(idat, CompressionMode.Decompress);
            using var inflated = new MemoryStream();
            z.CopyTo(inflated);

            if (interlace == 0)
            {
                var channels = colorType switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => 0 };
                if (channels == 0)
                {
                    return null;
                }

                var stride = 1 + (width * channels * bitDepth + 7) / 8;
                if (inflated.Length != (long)stride * height)
                {
                    return null;
                }
            }
        }
        catch (InvalidDataException)
        {
            return null;
        }

        return new ImageDimensions("png", width, height);
    }

    private static ImageDimensions? ReadJpeg(ReadOnlySpan<byte> data)
    {
        var pos = 2;
        while (pos + 4 < data.Length)
        {
            if (data[pos] != 0xFF)
            {
                return null;
            }

            var marker = data[pos + 1];
            if (marker == 0xFF)
            {
                pos++;
                continue;
            }

            if (marker is 0xD8 or 0x01 or (>= 0xD0 and <= 0xD7))
            {
                pos += 2;
                continue;
            }

            var len = BinaryPrimitives.ReadUInt16BigEndian(data[(pos + 2)..]);
            var isSof = marker is >= 0xC0 and <= 0xCF and not 0xC4 and not 0xC8 and not 0xCC;
            if (isSof && pos + 9 < data.Length)
            {
                var height = BinaryPrimitives.ReadUInt16BigEndian(data[(pos + 5)..]);
                var width = BinaryPrimitives.ReadUInt16BigEndian(data[(pos + 7)..]);
                return new ImageDimensions("jpg", width, height);
            }

            pos += 2 + len;
        }

        return null;
    }
}
