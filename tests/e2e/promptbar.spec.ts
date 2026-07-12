import { expect, test, type Page } from "@playwright/test";

test("loads workbench and navigates primary surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Promptbar" })).toBeVisible();
  await expect(page.getByText(/^6 prompts ·/i)).toBeVisible();

  const navigation = page.getByRole("complementary");

  await navigation.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Kind")).toBeVisible();

  const search = page.getByRole("textbox", { name: "Search corpus" });
  await search.fill("termination");
  const searchResponse = waitForSearch(page, "termination");
  await search.press("Enter");
  await searchResponse;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination");
  const results = page.getByRole("article");
  await expect(results).toHaveCount(1);
  await expect(
    results.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();
  await expect(
    results.getByRole("switch", {
      name: "Include Design an agent workflow in AI context",
    }),
  ).toBeVisible();

  await navigation.getByRole("button", { name: "Editor" }).click();
  await expect(page.getByRole("button", { name: "Reveal raw" })).toBeVisible();

  await navigation.getByRole("button", { name: "Evals" }).click();
  await expect(page.getByRole("button", { name: /Run/i })).toBeVisible();
});

test("hydrates shareable filters and restores committed search history", async ({
  page,
}) => {
  const initialSearch =
    "?view=search&q=termination&mode=lexical&kind=canon&status=inbox&tag=agent";
  const initialResponse = waitForSearch(page, "termination");
  await page.goto(`/${initialSearch}`);
  await initialResponse;

  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination&kind=canon&status=inbox&tag=agent");
  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("termination");
  await expect(
    page.getByRole("combobox", { name: "Search mode" }),
  ).toContainText("FTS");
  await expect(page.getByRole("combobox", { name: "Kind" })).toContainText(
    "canon",
  );
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText(
    "inbox",
  );
  await expect(page.getByRole("combobox", { name: "Tag" })).toContainText(
    "agent",
  );
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Search corpus" }).fill("database");
  await page.getByRole("combobox", { name: "Tag" }).click();
  await page.getByRole("option", { name: /^database\b/ }).click();
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination&kind=canon&status=inbox&tag=agent");

  const refreshed = waitForSearch(page, "database");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshed;
  const databaseSearch =
    "?view=search&q=database&kind=canon&status=inbox&tag=database";
  await expect.poll(() => new URL(page.url()).search).toBe(databaseSearch);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Plan a database change" }),
  ).toBeVisible();

  const repeated = waitForSearch(page, "database");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await repeated;
  const restoredInitial = waitForSearch(page, "termination");
  await page.goBack();
  await restoredInitial;
  await expect(
    page.getByRole("textbox", { name: "Search corpus" }),
  ).toHaveValue("termination");
  await expect(page.getByRole("combobox", { name: "Tag" })).toContainText(
    "agent",
  );
  await expect(
    page.getByRole("heading", { name: "Design an agent workflow" }),
  ).toBeVisible();

  const restoredDatabase = waitForSearch(page, "database");
  await page.goForward();
  await restoredDatabase;
  await expect.poll(() => new URL(page.url()).search).toBe(databaseSearch);
  await expect(
    page.getByRole("heading", { name: "Plan a database change" }),
  ).toBeVisible();

  const invalidFieldResponse = waitForSearch(page, "termination");
  await page.goto(
    "/?tag=agent&ignored=1&status=invalid&view=search&mode=invalid&q=termination&kind=canon",
  );
  await invalidFieldResponse;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=termination&kind=canon&tag=agent");
  await expect(
    page.getByRole("combobox", { name: "Search mode" }),
  ).toContainText("FTS");
  await expect(page.getByRole("combobox", { name: "Status" })).toContainText(
    "All",
  );
  await expect(page.getByRole("combobox", { name: "Tag" })).toContainText(
    "agent",
  );
});

test("copies only the committed canonical search link with fallback guidance", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { copiedSearchUrl?: string }).copiedSearchUrl =
            value;
        },
      },
    });
  });
  const response = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await response;

  await page
    .getByRole("textbox", { name: "Search corpus" })
    .fill("uncommitted draft");
  await page.getByRole("button", { name: "Copy link" }).click();
  const copiedUrl = await page.evaluate(
    () => (window as Window & { copiedSearchUrl?: string }).copiedSearchUrl,
  );
  expect(copiedUrl).toBe(page.url());
  expect(new URL(copiedUrl!).search).toBe("?view=search&q=termination");
  await expect(page.getByText("Search link copied.")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    });
  });
  const beforeFailure = page.url();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(
    page.getByText("Couldn’t copy link. Copy it from the address bar."),
  ).toBeVisible();
  expect(page.url()).toBe(beforeFailure);
});

test("clears stale cards and announces a failed committed search", async ({
  page,
}) => {
  const initialResponse = waitForSearch(page, "termination");
  await page.goto("/?view=search&q=termination");
  await initialResponse;
  await expect(page.getByRole("article")).toHaveCount(1);

  let failureBody = "Search unavailable.";
  await page.route("**/api/search?**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: failureBody,
    });
  });
  const failedResponse = waitForFailedSearch(page, "broken");
  const search = page.getByRole("textbox", { name: "Search corpus" });
  await search.fill("broken");
  await search.press("Enter");
  await failedResponse;

  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=broken");
  await expect(page.getByRole("article")).toHaveCount(0);
  const searchAlert = page.getByText("Search unavailable.", { exact: true });
  await expect(searchAlert).toHaveAttribute("role", "alert");

  failureBody = "";
  const emptyFailure = waitForFailedSearch(page, "empty-error");
  await search.fill("empty-error");
  await search.press("Enter");
  await emptyFailure;
  await expect
    .poll(() => new URL(page.url()).search)
    .toBe("?view=search&q=empty-error");
  await expect(page.getByRole("article")).toHaveCount(0);
  const fallbackAlert = page.getByText("Unable to search corpus.", {
    exact: true,
  });
  await expect(fallbackAlert).toHaveAttribute("role", "alert");
});

function waitForSearch(page: Page, query: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.ok() &&
      url.pathname === "/api/search" &&
      url.searchParams.get("q") === query
    );
  });
}

function waitForFailedSearch(page: Page, query: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.status() === 500 &&
      url.pathname === "/api/search" &&
      url.searchParams.get("q") === query
    );
  });
}
