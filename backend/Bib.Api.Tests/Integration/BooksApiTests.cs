using System.Net;
using System.Net.Http.Json;
using Bib.Api.Books;
using Bib.Api.Conversion;
using Bib.Api.Tests.Fixtures;

namespace Bib.Api.Tests.Integration;

public sealed class BooksApiTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static byte[] SamplePdf() => new FixturePdf()
        .WithInfo("The Lighthouse", "A. Keeper")
        .Page(p => p.Paragraph("The keeper climbed the stairs.").Jpeg(TestImages.SampleJpeg(), 128, 96).Paragraph("He lit the lamp."))
        .Page(p => p.Paragraph("Second page."))
        .Page(p => p.Paragraph("Third page."))
        .Build();

    [Fact]
    public async Task Book_endpoints_require_login()
    {
        var anonymous = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/books")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.UploadAsync(SamplePdf())).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/auth/me")).StatusCode);
    }

    [Fact]
    public async Task Upload_is_converted_verified_and_readable()
    {
        var client = await factory.CreateUserClientAsync();

        var book = await client.UploadAndWaitAsync(SamplePdf());

        Assert.Equal("Ready", book.Status);
        Assert.Equal("Verified", book.VerificationStatus);
        Assert.Equal(0, book.PagesWithIssues);
        Assert.Equal(("The Lighthouse", "A. Keeper", 3), (book.Title, book.Author, book.PageCount));
        Assert.True(book.HasCover);

        var report = (await client.GetFromJsonAsync<VerificationReport>($"/api/books/{book.Id}/verification"))!;
        Assert.Equal(PageStatus.Pass, report.Status);
        Assert.All(report.Pages, p => Assert.Equal(PageStatus.Pass, p.Status));

        var detail = (await client.GetFromJsonAsync<BookDetailDto>($"/api/books/{book.Id}"))!;
        Assert.Equal(["Page 1", "Page 2", "Page 3"], detail.Chapters.Select(c => c.Title));

        var chapter = (await client.GetFromJsonAsync<ChapterDto>($"/api/books/{book.Id}/chapters/1"))!;
        Assert.Equal(["p", "img", "p"], chapter.Blocks.Select(b => b.Type));
        Assert.Equal("The keeper climbed the stairs.", chapter.Blocks[0].Text);
        Assert.Equal(PageStatus.Pass, chapter.Verification!.Status);

        var image = await client.GetAsync($"/api/books/{book.Id}/images/{chapter.Blocks[1].Src}");
        Assert.Equal(HttpStatusCode.OK, image.StatusCode);
        Assert.Equal("image/jpeg", image.Content.Headers.ContentType!.MediaType);
        Assert.Equal(TestImages.SampleJpeg(), await image.Content.ReadAsByteArrayAsync());

        var cover = await client.GetAsync($"/api/books/{book.Id}/cover");
        Assert.Equal("image/png", cover.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Chapter_navigation_is_bounded()
    {
        var client = await factory.CreateUserClientAsync();
        var book = await client.UploadAndWaitAsync(SamplePdf());

        var first = (await client.GetFromJsonAsync<ChapterDto>($"/api/books/{book.Id}/chapters/1"))!;
        var middle = (await client.GetFromJsonAsync<ChapterDto>($"/api/books/{book.Id}/chapters/2"))!;
        var last = (await client.GetFromJsonAsync<ChapterDto>($"/api/books/{book.Id}/chapters/3"))!;

        Assert.Equal((null, 2, 3), (first.Prev, first.Next, first.Total));
        Assert.Equal((1, 3), (middle.Prev, middle.Next));
        Assert.Equal((2, (int?)null), (last.Prev, last.Next));
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/books/{book.Id}/chapters/0")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/books/{book.Id}/chapters/4")).StatusCode);
    }

    [Fact]
    public async Task Users_cannot_see_or_touch_each_others_books()
    {
        var alice = await factory.CreateUserClientAsync();
        var bob = await factory.CreateUserClientAsync();
        var book = await alice.UploadAndWaitAsync(SamplePdf());
        var chapter = (await alice.GetFromJsonAsync<ChapterDto>($"/api/books/{book.Id}/chapters/1"))!;

        Assert.Empty((await bob.GetFromJsonAsync<List<BookSummaryDto>>("/api/books"))!);
        foreach (var url in new[]
                 {
                     $"/api/books/{book.Id}",
                     $"/api/books/{book.Id}/chapters/1",
                     $"/api/books/{book.Id}/verification",
                     $"/api/books/{book.Id}/cover",
                     $"/api/books/{book.Id}/images/{chapter.Blocks[1].Src}",
                 })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync(url)).StatusCode);
        }

        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PatchAsJsonAsync($"/api/books/{book.Id}", new UpdateBookRequest("Stolen", null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await bob.PutAsJsonAsync($"/api/books/{book.Id}/progress", new SaveProgressRequest(1, 0))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/books/{book.Id}")).StatusCode);

        // Alice's book is untouched.
        var still = (await alice.GetFromJsonAsync<BookDetailDto>($"/api/books/{book.Id}"))!;
        Assert.Equal("The Lighthouse", still.Book.Title);
    }

    [Theory]
    [InlineData("..%2Fsource.pdf")]
    [InlineData("source.pdf")]
    [InlineData("p1-1.exe")]
    [InlineData("..%2F..%2Fbooks")]
    public async Task Image_endpoint_rejects_anything_but_image_names(string file)
    {
        var client = await factory.CreateUserClientAsync();
        var book = await client.UploadAndWaitAsync(SamplePdf());

        var response = await client.GetAsync($"/api/books/{book.Id}/images/{file}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Upload_rejects_non_pdf_and_empty_files()
    {
        var client = await factory.CreateUserClientAsync();

        var notPdf = await client.UploadAsync("<html>not a pdf</html>"u8.ToArray(), "evil.pdf");
        var empty = await client.UploadAsync([], "empty.pdf");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, notPdf.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<List<BookSummaryDto>>("/api/books"))!);
    }

    [Fact]
    public async Task Damaged_pdf_ends_as_failed_with_a_readable_message()
    {
        var client = await factory.CreateUserClientAsync();

        var book = await client.UploadAndWaitAsync("%PDF-1.7 garbage that is not a pdf"u8.ToArray(), "broken.pdf");

        Assert.Equal("Failed", book.Status);
        Assert.Contains("could not be read", book.Error);
        Assert.Equal("broken", book.Title);
    }

    [Fact]
    public async Task Reading_progress_is_saved_and_listed()
    {
        var client = await factory.CreateUserClientAsync();
        var book = await client.UploadAndWaitAsync(SamplePdf());

        var save = await client.PutAsJsonAsync($"/api/books/{book.Id}/progress", new SaveProgressRequest(2, 42.5));
        var invalidChapter = await client.PutAsJsonAsync($"/api/books/{book.Id}/progress", new SaveProgressRequest(9, 0));
        var invalidScroll = await client.PutAsJsonAsync($"/api/books/{book.Id}/progress", new SaveProgressRequest(1, 120));

        Assert.Equal(HttpStatusCode.NoContent, save.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidChapter.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, invalidScroll.StatusCode);
        var listed = Assert.Single((await client.GetFromJsonAsync<List<BookSummaryDto>>("/api/books"))!);
        Assert.Equal((2, 42.5), (listed.Progress!.ChapterNumber, listed.Progress.ScrollPercent));
    }

    [Fact]
    public async Task Books_can_be_renamed_and_deleted()
    {
        var client = await factory.CreateUserClientAsync();
        var book = await client.UploadAndWaitAsync(SamplePdf());

        var renamed = await client.PatchAsJsonAsync($"/api/books/{book.Id}", new UpdateBookRequest("  New Title ", ""));
        var invalid = await client.PatchAsJsonAsync($"/api/books/{book.Id}", new UpdateBookRequest("   ", null));

        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        var updated = (await renamed.Content.ReadFromJsonAsync<BookSummaryDto>())!;
        Assert.Equal(("New Title", (string?)null), (updated.Title, updated.Author));
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);

        var bookDir = Path.Combine(factory.StorageRoot, "books", book.Id.ToString("N"));
        Assert.True(Directory.Exists(bookDir));

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/books/{book.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/books/{book.Id}")).StatusCode);
        Assert.False(Directory.Exists(bookDir));
    }

    [Fact]
    public async Task Me_and_logout_work()
    {
        var client = await factory.CreateUserClientAsync();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/auth/me")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }
}
