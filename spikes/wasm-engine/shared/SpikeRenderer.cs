using Bib.Conversion;
using UglyToad.PdfPig;

namespace Bib.Spike;

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
