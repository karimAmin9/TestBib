using System.Runtime.InteropServices.JavaScript;
using Bib.Conversion;

namespace Bib.Engine;

/// <summary>Functions engine-worker.js provides to .NET (registered with setModuleImports).</summary>
internal static partial class BrowserHost
{
    private const string Module = "bib-engine";

    [JSImport("nfkc", Module)]
    internal static partial string Nfkc(string text);

    [JSImport("progress", Module)]
    internal static partial void Progress(string stage, int done, int total);

    /// <summary>Resolves to <c>{ width, height, bgra: Uint8Array }</c>; pdf.js renders it on the page's main thread.</summary>
    [JSImport("renderPage", Module)]
    internal static partial Task<JSObject> RenderPage(int pageIndex, double scale);
}

/// <summary>
/// Renders with pdf.js. The page already has the same PDF open, so only the page index and scale cross over.
/// </summary>
internal sealed class JsPageRenderer : IPageRenderer
{
    public async ValueTask<RenderedPage> RenderAsync(byte[] pdf, int pageIndex, double scale)
    {
        using var page = await BrowserHost.RenderPage(pageIndex, scale);
        return new RenderedPage(
            page.GetPropertyAsByteArray("bgra") ?? throw new InvalidOperationException("No pixels were rendered."),
            page.GetPropertyAsInt32("width"),
            page.GetPropertyAsInt32("height"));
    }
}
