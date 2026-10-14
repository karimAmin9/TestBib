# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Bib.Api/Bib.Api.csproj Bib.Api/
COPY Bib.Conversion/Bib.Conversion.csproj Bib.Conversion/
RUN dotnet restore Bib.Api/Bib.Api.csproj
COPY Bib.Conversion/ Bib.Conversion/
COPY Bib.Api/ Bib.Api/
RUN dotnet publish Bib.Api/Bib.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
RUN mkdir -p /data && chown "$APP_UID" /data
ENV ASPNETCORE_HTTP_PORTS=8080 \
    Storage__Root=/data
VOLUME /data
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Bib.Api.dll"]
