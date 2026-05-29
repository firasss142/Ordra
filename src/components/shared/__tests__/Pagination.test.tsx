import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import frMessages from "@/messages/fr.json";
import { Pagination } from "../Pagination";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => {
    return (key: string, params?: Record<string, unknown>) => {
      const parts = namespace ? `${namespace}.${key}`.split(".") : key.split(".");
      let val: unknown = frMessages;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      if (typeof val !== "string") return key;
      if (params) {
        return Object.entries(params).reduce(
          (s, [k, v]) => s.replace(`{${k}}`, String(v)),
          val,
        );
      }
      return val;
    };
  },
}));

const noop = () => {};

describe("Pagination", () => {
  it("renders prev/next buttons with i18n labels", () => {
    render(
      <Pagination
        currentPage={1}
        pageSize={25}
        hasNext
        hasPrev={false}
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /Précédent/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Suivant/ })).toBeDefined();
  });

  it("disables prev on page 1 and enables next when hasNext", () => {
    render(
      <Pagination
        currentPage={1}
        pageSize={25}
        hasNext
        hasPrev={false}
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(
      (screen.getByRole("button", { name: /Précédent/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Suivant/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("calls onNext / onPrev when buttons are clicked", () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(
      <Pagination
        currentPage={2}
        pageSize={25}
        hasNext
        hasPrev
        onNext={onNext}
        onPrev={onPrev}
        onPageSizeChange={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Précédent/ }));
    fireEvent.click(screen.getByRole("button", { name: /Suivant/ }));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("renders a page-size dropdown with provided options and current value", () => {
    render(
      <Pagination
        currentPage={1}
        pageSize={50}
        pageSizeOptions={[10, 25, 50, 100]}
        hasNext={false}
        hasPrev={false}
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={noop}
      />,
    );
    const select = screen.getByLabelText(/Lignes par page/) as HTMLSelectElement;
    expect(select.value).toBe("50");
    const options = Array.from(select.querySelectorAll("option")).map(
      (o) => Number((o as HTMLOptionElement).value),
    );
    expect(options).toEqual([10, 25, 50, 100]);
  });

  it("calls onPageSizeChange with the parsed number when the dropdown changes", () => {
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        currentPage={1}
        pageSize={25}
        hasNext={false}
        hasPrev={false}
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Lignes par page/), {
      target: { value: "100" },
    });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });

  it("hides the dropdown when pageSizeOptions is empty", () => {
    render(
      <Pagination
        currentPage={1}
        pageSize={25}
        pageSizeOptions={[]}
        hasNext={false}
        hasPrev={false}
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.queryByLabelText(/Lignes par page/)).toBeNull();
  });

  it("shows 'Page X' when totalItems is not provided", () => {
    render(
      <Pagination
        currentPage={3}
        pageSize={25}
        hasNext={false}
        hasPrev
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.getByText(/Page 3/)).toBeDefined();
  });

  it("shows 'Page X of Y' when totalItems is provided", () => {
    render(
      <Pagination
        currentPage={2}
        pageSize={25}
        totalItems={120}
        hasNext
        hasPrev
        onNext={noop}
        onPrev={noop}
        onPageSizeChange={noop}
      />,
    );
    expect(screen.getByText(/Page 2 sur 5/)).toBeDefined();
  });
});
