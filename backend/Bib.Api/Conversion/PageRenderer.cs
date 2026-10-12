using Docnet.Core;
using Docnet.Core.Models;

namespace Bib.Api.Conversion;

/// <summary>A rendered page as BGRA pixels.</summary>
public sealed record RenderedPage(byte[] Bgra, int Width, int Height);

public interface IPageRenderer
{
    /// <summary>Renders the 0-based page at <paramref name="scale"/> (1.0 = 72 dpi).</summary>
    RenderedPage Render(byte[] pdf, int pageIndex, double scale);
}

/// <summary>PDFium-based renderer (Docnet). PDFium is not thread-safe, so calls are serialized.</summary>
public sealed class DocnetPageRenderer : IPageRenderer
{
    private static readonly Lock Gate = new();

    public RenderedPage Render(byte[] pdf, int pageIndex, double scale)
    {
        lock (Gate)
        {
            using var doc = DocLib.Instance.GetDocReader(pdf, new PageDimensions(scale));
            using var page = doc.GetPageReader(pageIndex);
            return new RenderedPage(page.GetImage(), page.GetPageWidth(), page.GetPageHeight());
        }
    }
}

public static class RenderedPageExtensions
{
    /// <summary>Crops a region given in pixels; clamps to the page.</summary>
    public static RenderedPage Crop(this RenderedPage page, int x, int y, int width, int height)
    {
        x = Math.Clamp(x, 0, page.Width);
        y = Math.Clamp(y, 0, page.Height);
        width = Math.Clamp(width, 0, page.Width - x);
        height = Math.Clamp(height, 0, page.Height - y);
        if (width == 0 || height == 0)
        {
            return page;
        }

        var result = new byte[width * height * 4];
        for (var row = 0; row < height; row++)
        {
            Buffer.BlockCopy(page.Bgra, ((y + row) * page.Width + x) * 4, result, row * width * 4, width * 4);
        }

        return new RenderedPage(result, width, height);
    }

    public static byte[] ToPng(this RenderedPage page) => PngEncoder.FromBgra(page.Bgra, page.Width, page.Height);
}
