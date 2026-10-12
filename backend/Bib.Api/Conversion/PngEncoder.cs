using System.Buffers.Binary;
using System.IO.Compression;
using System.IO.Hashing;

namespace Bib.Api.Conversion;

/// <summary>Minimal PNG encoder for 8-bit RGB images (used for pages rendered by PDFium).</summary>
public static class PngEncoder
{
    private static readonly byte[] Signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>Encodes BGRA pixels, compositing transparency onto a white background.</summary>
    public static byte[] FromBgra(ReadOnlySpan<byte> bgra, int width, int height)
    {
        ArgumentOutOfRangeException.ThrowIfNotEqual(bgra.Length, width * height * 4, nameof(bgra));

        var raw = new byte[height * (1 + width * 3)];
        var o = 0;
        for (var y = 0; y < height; y++)
        {
            raw[o++] = 0; // filter: none
            var row = bgra.Slice(y * width * 4, width * 4);
            for (var x = 0; x < width; x++)
            {
                var b = row[x * 4];
                var g = row[x * 4 + 1];
                var r = row[x * 4 + 2];
                var a = row[x * 4 + 3];
                raw[o++] = Blend(r, a);
                raw[o++] = Blend(g, a);
                raw[o++] = Blend(b, a);
            }
        }

        using var ms = new MemoryStream();
        ms.Write(Signature);

        var ihdr = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(0), width);
        BinaryPrimitives.WriteInt32BigEndian(ihdr.AsSpan(4), height);
        ihdr[8] = 8; // bit depth
        ihdr[9] = 2; // color type: truecolor
        WriteChunk(ms, "IHDR", ihdr);

        using (var compressed = new MemoryStream())
        {
            using (var z = new ZLibStream(compressed, CompressionLevel.Optimal, leaveOpen: true))
            {
                z.Write(raw);
            }

            WriteChunk(ms, "IDAT", compressed.ToArray());
        }

        WriteChunk(ms, "IEND", []);
        return ms.ToArray();
    }

    private static byte Blend(byte channel, byte alpha) => (byte)((channel * alpha + 255 * (255 - alpha) + 127) / 255);

    private static void WriteChunk(Stream s, string type, byte[] data)
    {
        Span<byte> len = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(len, data.Length);
        s.Write(len);

        var typeBytes = System.Text.Encoding.ASCII.GetBytes(type);
        s.Write(typeBytes);
        s.Write(data);

        var crc = new Crc32();
        crc.Append(typeBytes);
        crc.Append(data);
        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc.GetCurrentHashAsUInt32());
        s.Write(crcBytes);
    }
}
