using Microsoft.Extensions.Options;

namespace Bib.Api.Storage;

public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>Root directory for uploaded PDFs and extracted images (relative to the content root).</summary>
    public string Root { get; set; } = "data";
}

/// <summary>Filesystem layout: {root}/books/{bookId}/source.pdf, cover.png, images/*.</summary>
public sealed class BookStorage
{
    public BookStorage(IOptions<StorageOptions> options, IHostEnvironment env)
    {
        Root = Path.GetFullPath(Path.Combine(env.ContentRootPath, options.Value.Root));
        Directory.CreateDirectory(Path.Combine(Root, "books"));
    }

    public string Root { get; }

    public string BookDir(Guid bookId) => Path.Combine(Root, "books", bookId.ToString("N"));

    public string SourcePath(Guid bookId) => Path.Combine(BookDir(bookId), "source.pdf");

    public string CoverPath(Guid bookId) => Path.Combine(BookDir(bookId), "cover.png");

    public string ImagesDir(Guid bookId) => Path.Combine(BookDir(bookId), "images");

    /// <summary>Removes output of a previous (possibly interrupted) conversion, keeping the source PDF.</summary>
    public void ResetOutput(Guid bookId)
    {
        if (Directory.Exists(ImagesDir(bookId)))
        {
            Directory.Delete(ImagesDir(bookId), recursive: true);
        }

        File.Delete(CoverPath(bookId));
        Directory.CreateDirectory(ImagesDir(bookId));
    }

    public void DeleteBook(Guid bookId)
    {
        if (Directory.Exists(BookDir(bookId)))
        {
            Directory.Delete(BookDir(bookId), recursive: true);
        }
    }
}
