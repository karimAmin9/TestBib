using System.Buffers.Binary;
using System.IO.Compression;
using Bib.Conversion;

namespace Bib.Api.Tests.Fixtures;

/// <summary>Decoded RGB pixels, used to compare images pixel by pixel.</summary>
public sealed record Pixels(int Width, int Height, byte[] Rgb);

public static class TestImages
{
    public static string FixturePath(string name) => Path.Combine(AppContext.BaseDirectory, "Fixtures", name);

    public static byte[] SampleJpeg() => File.ReadAllBytes(FixturePath("sample.jpg"));

    /// <summary>A deterministic RGB pattern so pixel comparisons are meaningful.</summary>
    public static Pixels Pattern(int width, int height, int seed)
    {
        var rgb = new byte[width * height * 3];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var i = (y * width + x) * 3;
                rgb[i] = (byte)(x * 7 + seed);
                rgb[i + 1] = (byte)(y * 11 + seed * 3);
                rgb[i + 2] = (byte)((x ^ y) + seed * 5);
            }
        }

        return new Pixels(width, height, rgb);
    }

    public static byte[] EncodePng(Pixels p)
    {
        var bgra = new byte[p.Width * p.Height * 4];
        for (var i = 0; i < p.Width * p.Height; i++)
        {
            bgra[i * 4] = p.Rgb[i * 3 + 2];
            bgra[i * 4 + 1] = p.Rgb[i * 3 + 1];
            bgra[i * 4 + 2] = p.Rgb[i * 3];
            bgra[i * 4 + 3] = 255;
        }

        return PngEncoder.FromBgra(bgra, p.Width, p.Height);
    }

    /// <summary>Decodes a non-interlaced 8-bit PNG (gray, RGB, gray+alpha, RGBA) to RGB.</summary>
    public static Pixels DecodePng(byte[] data)
    {
        var width = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(16));
        var height = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(20));
        var bitDepth = data[24];
        var colorType = data[25];
        Assert.Equal(8, bitDepth);
        Assert.Equal(0, data[28]);
        var channels = colorType switch { 0 => 1, 2 => 3, 4 => 2, 6 => 4, _ => throw new NotSupportedException($"color type {colorType}") };

        using var idat = new MemoryStream();
        var pos = 8;
        while (pos < data.Length)
        {
            var len = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(pos));
            var type = System.Text.Encoding.ASCII.GetString(data, pos + 4, 4);
            if (type == "IDAT")
            {
                idat.Write(data, pos + 8, len);
            }

            pos += 12 + len;
        }

        idat.Position = 0;
        using var z = new ZLibStream(idat, CompressionMode.Decompress);
        using var ms = new MemoryStream();
        z.CopyTo(ms);
        var raw = ms.ToArray();

        var stride = width * channels;
        var pixels = new byte[height * stride];
        for (var y = 0; y < height; y++)
        {
            var filter = raw[y * (stride + 1)];
            for (var x = 0; x < stride; x++)
            {
                var v = raw[y * (stride + 1) + 1 + x];
                var a = x >= channels ? pixels[y * stride + x - channels] : 0;
                var b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
                var c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
                pixels[y * stride + x] = filter switch
                {
                    0 => v,
                    1 => (byte)(v + a),
                    2 => (byte)(v + b),
                    3 => (byte)(v + (a + b) / 2),
                    4 => (byte)(v + Paeth(a, b, c)),
                    _ => throw new NotSupportedException($"filter {filter}"),
                };
            }
        }

        var rgb = new byte[width * height * 3];
        for (var i = 0; i < width * height; i++)
        {
            switch (channels)
            {
                case 1:
                case 2:
                    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = pixels[i * channels];
                    break;
                default:
                    rgb[i * 3] = pixels[i * channels];
                    rgb[i * 3 + 1] = pixels[i * channels + 1];
                    rgb[i * 3 + 2] = pixels[i * channels + 2];
                    break;
            }
        }

        return new Pixels(width, height, rgb);
    }

    private static int Paeth(int a, int b, int c)
    {
        var p = a + b - c;
        var pa = Math.Abs(p - a);
        var pb = Math.Abs(p - b);
        var pc = Math.Abs(p - c);
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
}
