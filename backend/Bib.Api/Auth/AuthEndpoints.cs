using System.Security.Claims;
using Bib.Api.Data;
using Microsoft.AspNetCore.Identity;

namespace Bib.Api.Auth;

public sealed record MeDto(string Id, string Email);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").RequireRateLimiting(RateLimits.Auth);

        // POST /register, POST /login?useCookies=true, ... (ASP.NET Core Identity API endpoints)
        auth.MapIdentityApi<AppUser>();

        auth.MapPost("/logout", async (SignInManager<AppUser> signIn) =>
        {
            await signIn.SignOutAsync();
            return TypedResults.NoContent();
        }).RequireAuthorization();

        auth.MapGet("/me", (ClaimsPrincipal user) => TypedResults.Ok(new MeDto(
            user.FindFirstValue(ClaimTypes.NameIdentifier)!,
            user.FindFirstValue(ClaimTypes.Email) ?? user.Identity!.Name!))).RequireAuthorization();
    }
}
