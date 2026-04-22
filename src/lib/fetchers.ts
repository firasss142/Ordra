export const jsonFetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error("fetch_failed");
    return r.json();
  });
