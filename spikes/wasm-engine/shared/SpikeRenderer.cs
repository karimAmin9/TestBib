using UglyToad.PdfPig;

namespace Bib.Api.Conversion;

// Copied from Bib.Api/Conversion/PageRenderer.cs minus the Docnet (PDFium) renderer, which has no WebAssembly build.
public sealed record RenderedPage(byte[] Bgra, int Width, int Height);

public interface IPageRenderer
{
    RenderedPage Render(byte[] pdf, int pageIndex, double scale);
}

/// <summary>Spike stand-in for PDFium: a white page of the right size. In the app, pdf.js rasterizes in the browser.</summary>
public sealed class BlankPageRenderer : IPageRenderer
{
    public RenderedPage Render(byte[] pdf, int pageIndex, double scale)
    {
        using var doc = PdfDocument.Open(pdf);
        var page = doc.GetPage(pageIndex + 1);
        var w = Math.Max(1, (int)Math.Round(page.Width * scale));
        var h = Math.Max(1, (int)Math.Round(page.Height * scale));
        var bgra = new byte[w * h * 4];
        Array.Fill(bgra, (byte)255);
        return new RenderedPage(bgra, w, h);
    }
}

public static class RenderedPageExtensions
{
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
