using System.Runtime.Versioning;
using Bib.Conversion;
using Bib.Engine;

[assembly: SupportedOSPlatform("browser")]

// .NET in the browser cannot do NFKC; the browser can (String.prototype.normalize, ICU-backed in Chromium).
TextNormalizer.NfkcImplementation = BrowserHost.Nfkc;
