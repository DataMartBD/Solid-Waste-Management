"""Serializer helpers.

The React app's field names are the contract — `hh`, `qr`, `dspId`, `estTier`,
`verifiedAt`, `lastVisit`. Rather than auto-camelising (which would mangle `hh`
into `hh` but `dspId` into `dsp_id`), every serializer maps names explicitly and
inherits the small conveniences below.
"""

from rest_framework import serializers


class SwmsModelSerializer(serializers.ModelSerializer):
    """ModelSerializer with server-assigned ids and blank-friendly text."""

    #: Fields the client may send on create but never change afterwards.
    write_once_fields: tuple[str, ...] = ()

    def build_standard_field(self, field_name, model_field):
        field_class, kwargs = super().build_standard_field(field_name, model_field)
        # Mock data used '' liberally (email, altPhone, contactPerson). Accept it.
        if model_field.blank and not model_field.null:
            kwargs.setdefault("allow_blank", True)
        return field_class, kwargs

    def update(self, instance, validated_data):
        for name in self.write_once_fields:
            validated_data.pop(name, None)
        return super().update(instance, validated_data)


class NullableDecimal(serializers.DecimalField):
    """Emits a JSON number (not a string) so charts can use it directly."""

    def __init__(self, **kwargs):
        kwargs.setdefault("coerce_to_string", False)
        super().__init__(**kwargs)

    def to_representation(self, value):
        if value is None:
            return None
        return float(super().to_representation(value))


class IdListField(serializers.ListField):
    """A list of text primary keys, e.g. route.stops or assignment.routes."""

    child = serializers.CharField(max_length=32)
