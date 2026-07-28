"""Uniform error envelope so the frontend has one shape to render.

Every failure becomes `{ "detail": str, "code": str, "fields": {field: [msg]} }`.
`code` values are stable, translatable keys the UI can map to Bangla strings.
"""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state."
    default_code = "conflict"


class DomainError(APIException):
    """A rule of the waste-management domain was violated."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "That action is not allowed."
    default_code = "domain_error"

    def __init__(self, detail=None, code=None):
        super().__init__(detail=detail, code=code)
        self.code = code or self.default_code


def swms_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(detail=getattr(exc, "message_dict", exc.messages))
    if isinstance(exc, IntegrityError):
        exc = Conflict(detail=str(exc).splitlines()[0])

    response = exception_handler(exc, context)
    if response is None:
        return None

    # An instance-level `code` wins over the class default: DomainError sets a
    # specific one per failure ("no_assignee", "already_converted"), and reading
    # `default_code` first would flatten every one of them to "domain_error".
    code = getattr(exc, "code", None) or getattr(exc, "default_code", "error")
    detail = response.data
    fields = {}

    if isinstance(detail, dict):
        if "detail" in detail and len(detail) == 1:
            detail = detail["detail"]
        else:
            fields = {k: v if isinstance(v, list) else [v] for k, v in detail.items()}
            detail = "Some fields need attention."
    elif isinstance(detail, list):
        detail = "; ".join(str(item) for item in detail)

    response.data = {"detail": str(detail), "code": str(code), "fields": fields}
    return response
