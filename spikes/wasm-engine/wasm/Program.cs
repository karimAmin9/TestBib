using System.Runtime.InteropServices.JavaScript;
using Bib.Conversion;
using Bib.Spike;

// .NET in the browser cannot do NFKC; the browser can (String.prototype.normalize, ICU-backed in Chromium).
TextNormalizer.NfkcImplementation = BrowserText.Nfkc;
Console.WriteLine("Bib conversion engine (WebAssembly) loaded");

public static partial class Engine
{
    /// <summary>Converts + verifies a PDF in the browser; image files go to the in-memory file system.</summary>
    [JSExport]
    public static string Convert(byte[] pdf) => SpikeRunner.Run(pdf, "/tmp");
}

internal static partial class BrowserText
{
    [JSImport("globalThis.bibNfkc")]
    internal static partial string Nfkc(string text);
}
