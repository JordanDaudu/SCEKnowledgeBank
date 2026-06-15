// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BrowseFilters, { type Sort, type Semester } from "./BrowseFilters";

// Lightweight i18n stub: return the key, appending the interpolated `value` so
// chip labels remain assertable without loading the real translation bundle.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { value?: unknown }) =>
      opts && "value" in opts ? `${key}:${String(opts.value)}` : key,
  }),
}));

type Overrides = Partial<React.ComponentProps<typeof BrowseFilters>>;

function renderFilters(overrides: Overrides = {}) {
  const props: React.ComponentProps<typeof BrowseFilters> = {
    courseId: "all",
    setCourseId: vi.fn(),
    lecturerName: "",
    setLecturerName: vi.fn(),
    semester: "" as Semester,
    setSemester: vi.fn(),
    academicYear: "",
    setAcademicYear: vi.fn(),
    categoryId: "all",
    setCategoryId: vi.fn(),
    materialType: "all",
    setMaterialType: vi.fn(),
    tagIds: [],
    toggleTag: vi.fn(),
    dateFrom: "",
    setDateFrom: vi.fn(),
    dateTo: "",
    setDateTo: vi.fn(),
    sort: "relevance" as Sort,
    setSort: vi.fn(),
    courses: [],
    categories: [],
    tags: [],
    debouncedLecturer: "",
    activeFilterCount: 0,
    clearAll: vi.fn(),
    ...overrides,
  };
  render(<BrowseFilters {...props} />);
  return props;
}

describe("BrowseFilters", () => {
  it("renders the filters trigger without an active-count badge when nothing is filtered", () => {
    renderFilters({ activeFilterCount: 0 });

    expect(screen.getByTestId("browse-filters-trigger")).toBeInTheDocument();
    // No active-filter chips row.
    expect(screen.queryByText("browse.filters.active")).not.toBeInTheDocument();
  });

  it("shows the active-filter count on the trigger when filters are applied", () => {
    renderFilters({ activeFilterCount: 3, semester: "fall" });

    const trigger = screen.getByTestId("browse-filters-trigger");
    expect(within(trigger).getByText("3")).toBeInTheDocument();
  });

  it("renders a chip per active filter and a clear-all button", () => {
    renderFilters({
      activeFilterCount: 2,
      semester: "fall",
      academicYear: "2024",
    });

    // The active row label plus one chip each for semester and year.
    expect(screen.getByText("browse.filters.active")).toBeInTheDocument();
    expect(screen.getByText("browse.filters.chipSemester:browse.filters.fall")).toBeInTheDocument();
    expect(screen.getByText("browse.filters.chipYear:2024")).toBeInTheDocument();
  });

  it("clears an individual filter when its chip remove button is clicked", async () => {
    const user = userEvent.setup();
    const props = renderFilters({ activeFilterCount: 1, academicYear: "2024" });

    const removeButtons = screen.getAllByLabelText("browse.filters.removeFilter");
    await user.click(removeButtons[0]);

    expect(props.setAcademicYear).toHaveBeenCalledWith("");
  });

  it("clears every filter when the chips row clear-all button is clicked", async () => {
    const user = userEvent.setup();
    const props = renderFilters({ activeFilterCount: 1, academicYear: "2024" });

    // Popover is closed, so only the chips-row clear-all button is mounted.
    const clearAllButtons = screen.getAllByText("browse.filters.clearAll");
    await user.click(clearAllButtons[clearAllButtons.length - 1]);

    expect(props.clearAll).toHaveBeenCalledTimes(1);
  });
});
