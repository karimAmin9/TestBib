using Bib.Conversion;
using Docnet.Core;
using Docnet.Core.Models;

namespace Bib.Api.Processing;

/// <summary>PDFium-based renderer (Docnet). PDFium is not thread-safe, so calls are serialized.</summary>
public sealed class DocnetPageRenderer : IPageRenderer
{
    private static readonly Lock Gate = new();

    public ValueTask<RenderedPage> RenderAsync(byte[] pdf, int pageIndex, double scale)
    {
        lock (Gate)
        {
            using var doc = DocLib.Instance.GetDocReader(pdf, new PageDimensions(scale));
            using var page = doc.GetPageReader(pageIndex);
            return ValueTask.FromResult(new RenderedPage(page.GetImage(), page.GetPageWidth(), page.GetPageHeight()));
        }
    }
}
