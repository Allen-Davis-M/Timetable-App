"""
Solver-related API endpoints.

`/api/solver/test` runs the worked example in app/services/solver.py to
confirm OR-Tools is installed and working correctly. This is a diagnostic
endpoint, not the real generation endpoint (that comes later, once the
database models are wired to the solver).
"""
from fastapi import APIRouter

from app.services.solver import solve_example

router = APIRouter(prefix="/api/solver", tags=["solver"])


@router.get("/test")
def test_solver():
    """Run a small built-in example through OR-Tools and return the result.

    Use this to sanity-check that the OR-Tools installation works before
    relying on the real /api/timetables/generate endpoint.
    """
    result = solve_example()
    return {"status": result.status, "assignments": result.assignments}
