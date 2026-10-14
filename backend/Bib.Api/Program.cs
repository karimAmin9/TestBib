using Bib.Api.Auth;
using Bib.Api.Books;
using Bib.Api.Data;
using Bib.Api.Processing;
using Bib.Api.Storage;
using Bib.Conversion;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddProblemDetails();
builder.Services.AddHealthChecks();
builder.Services.AddSingleton(TimeProvider.System);

builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseNpgsql(builder.Configuration.GetConnectionString("Default")
                ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));

builder.Services.AddAuthorization();
builder.Services
    .AddIdentityApiEndpoints<AppUser>(o =>
    {
        o.User.RequireUniqueEmail = true;
        o.Password.RequiredLength = 8;
        o.Password.RequireNonAlphanumeric = false;
        o.Lockout.MaxFailedAccessAttempts = 10;
    })
    .AddEntityFrameworkStores<AppDbContext>();

builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "bib.auth";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromDays(14);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Task.CompletedTask;
    };
    o.Events.OnRedirectToAccessDenied = ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return Task.CompletedTask;
    };
});

builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = BookEndpoints.MaxUploadBytes + 1024 * 1024);
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.Section));

// Keep cookie-encryption keys on the data volume so restarts/redeploys don't log everyone out.
var storageRoot = Path.GetFullPath(Path.Combine(
    builder.Environment.ContentRootPath,
    builder.Configuration[$"{StorageOptions.Section}:{nameof(StorageOptions.Root)}"] ?? new StorageOptions().Root));
builder.Services.AddDataProtection()
    .SetApplicationName("Bib")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(storageRoot, "keys")));
builder.Services.AddSingleton<BookStorage>();
builder.Services.AddSingleton<IPageRenderer, DocnetPageRenderer>();
builder.Services.AddSingleton<PdfProcessor>();
builder.Services.AddSingleton<ConversionVerifier>();
builder.Services.AddScoped<BookConversionService>();
builder.Services.AddSingleton<ProcessingQueue>();
builder.Services.AddHostedService<BookProcessingWorker>();

var authPerMinute = builder.Configuration.GetValue("RateLimits:AuthPerMinute", 20);
var uploadsPerHour = builder.Configuration.GetValue("RateLimits:UploadsPerHour", 30);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy(RateLimits.Auth, ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authPerMinute, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy(RateLimits.Upload, ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = uploadsPerHour, Window = TimeSpan.FromHours(1) }));
});

var app = builder.Build();

if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

app.UseForwardedHeaders();
app.Use((ctx, next) =>
{
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    return next(ctx);
});
app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapHealthChecks("/health");
app.MapAuthEndpoints();
app.MapBookEndpoints();

app.Run();

public partial class Program;

public static class RateLimits
{
    public const string Auth = "auth";
    public const string Upload = "upload";
}
