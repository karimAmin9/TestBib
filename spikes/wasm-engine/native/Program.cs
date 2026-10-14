using Bib.Spike;

// Usage: Spike.Native <pdf>...   Prints one JSON line per file (second run of each, so the JIT is warm).
foreach (var path in args)
{
    var pdf = File.ReadAllBytes(path);
    SpikeRunner.Run(pdf, Path.GetTempPath());
    Console.WriteLine($"{Path.GetFileName(path)}\t{new FileInfo(path).Length / 1048576.0:F1} MB\t{SpikeRunner.Run(pdf, Path.GetTempPath())}");
}
