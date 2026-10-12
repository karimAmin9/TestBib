using System.Threading.Channels;
using Bib.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace Bib.Api.Processing;

public sealed class ProcessingQueue
{
    private readonly Channel<Guid> _channel = Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });

    public void Enqueue(Guid bookId) => _channel.Writer.TryWrite(bookId);

    public IAsyncEnumerable<Guid> ReadAllAsync(CancellationToken ct) => _channel.Reader.ReadAllAsync(ct);
}

/// <summary>Converts queued books one at a time; re-queues unfinished books after a restart.</summary>
public sealed class BookProcessingWorker(
    ProcessingQueue queue,
    IServiceScopeFactory scopes,
    ILogger<BookProcessingWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RequeueUnfinishedAsync(stoppingToken);

        await foreach (var bookId in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var service = scope.ServiceProvider.GetRequiredService<BookConversionService>();
                await service.ConvertAsync(bookId, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Unhandled error converting book {BookId}", bookId);
            }
        }
    }

    private async Task RequeueUnfinishedAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var pending = await db.Books.Where(b => b.Status == BookStatus.Processing)
                .OrderBy(b => b.CreatedAt).Select(b => b.Id).ToListAsync(ct);
            pending.ForEach(queue.Enqueue);
            if (pending.Count > 0)
            {
                logger.LogInformation("Re-queued {Count} unfinished books", pending.Count);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError(ex, "Could not re-queue unfinished books");
        }
    }
}
