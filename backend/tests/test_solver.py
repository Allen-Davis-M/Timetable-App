from app.services.solver import solve_example


def test_solve_example_is_feasible():
    """The worked example has an obvious valid solution, so the solver
    should always find it — this test mainly catches OR-Tools install
    or API-usage regressions."""
    result = solve_example()
    assert result.status in ("optimal", "feasible")
    assert len(result.assignments) == 2  # Math + English, both scheduled


def test_solve_example_no_double_booking():
    result = solve_example()
    periods_used = [a["period"] for a in result.assignments]
    assert len(periods_used) == len(set(periods_used))
