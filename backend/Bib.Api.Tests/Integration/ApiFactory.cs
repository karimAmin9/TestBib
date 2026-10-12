using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Bib.Api.Books;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Testcontainers.PostgreSql;

namespace Bib.Api.Tests.Integration;

/// <summary>Boots the real API against a throw-away PostgreSQL container.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine").Build();

    public string StorageRoot { get; } = Path.Combine(Path.GetTempPath(), "bib-api-tests", Guid.NewGuid().ToString("N"));

    public async Task InitializeAsync() => await _postgres.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
        try
        {
            Directory.Delete(StorageRoot, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", _postgres.GetConnectionString());
        builder.UseSetting("Storage:Root", StorageRoot);
        builder.UseSetting("RateLimits:AuthPerMinute", "100000");
    }

    /// <summary>A client with its own cookie jar, registered and logged in as a fresh user.</summary>
    public async Task<HttpClient> CreateUserClientAsync()
    {
        var client = CreateClient();
        var email = $"user-{Guid.NewGuid():N}@example.test";
        const string password = "Sup3rSecret!";

        (await client.PostAsJsonAsync("/api/auth/register", new { email, password })).EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/auth/login?useCookies=true", new { email, password })).EnsureSuccessStatusCode();
        return client;
    }
}

public static class ApiClientExtensions
{
    public static async Task<HttpResponseMessage> UploadAsync(this HttpClient client, byte[] bytes, string fileName = "story.pdf")
    {
        using var content = new MultipartFormDataContent();
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        content.Add(file, "file", fileName);
        return await client.PostAsync("/api/books", content);
    }

    public static async Task<BookSummaryDto> UploadAndWaitAsync(this HttpClient client, byte[] bytes, string fileName = "story.pdf")
    {
        var response = await client.UploadAsync(bytes, fileName);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var created = (await response.Content.ReadFromJsonAsync<BookSummaryDto>())!;
        Assert.Equal("Processing", created.Status);
        return await client.WaitForConversionAsync(created.Id);
    }

    public static async Task<BookSummaryDto> WaitForConversionAsync(this HttpClient client, Guid id)
    {
        var deadline = DateTime.UtcNow.AddSeconds(60);
        while (DateTime.UtcNow < deadline)
        {
            var detail = (await client.GetFromJsonAsync<BookDetailDto>($"/api/books/{id}"))!;
            if (detail.Book.Status != "Processing")
            {
                return detail.Book;
            }

            await Task.Delay(100);
        }

        throw new TimeoutException("Conversion did not finish in time.");
    }
}
