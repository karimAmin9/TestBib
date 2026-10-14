using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Bib.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Book> Books => Set<Book>();

    public DbSet<Chapter> Chapters => Set<Chapter>();

    public DbSet<ReadingProgress> ReadingProgress => Set<ReadingProgress>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Book>(b =>
        {
            b.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            b.Property(x => x.VerificationStatus).HasConversion<string>().HasMaxLength(20);
            b.Property(x => x.VerificationJson).HasColumnType("jsonb");
            b.HasOne<AppUser>().WithMany().HasForeignKey(x => x.OwnerId).OnDelete(DeleteBehavior.Cascade);
            b.HasIndex(x => x.OwnerId);
            b.HasIndex(x => x.Status); // startup re-queue of unfinished books
        });

        builder.Entity<Chapter>(c =>
        {
            c.Property(x => x.BlocksJson).HasColumnType("jsonb");
            c.Property(x => x.RemovedJson).HasColumnType("jsonb");
            c.HasOne<Book>().WithMany().HasForeignKey(x => x.BookId).OnDelete(DeleteBehavior.Cascade);
            c.HasIndex(x => new { x.BookId, x.Number }).IsUnique();
        });

        builder.Entity<ReadingProgress>(p =>
        {
            p.HasKey(x => new { x.UserId, x.BookId });
            p.HasOne<AppUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            p.HasOne<Book>().WithMany().HasForeignKey(x => x.BookId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
