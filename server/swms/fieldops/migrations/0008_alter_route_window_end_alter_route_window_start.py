"""The route window defaults become real `time` objects.

They were the strings `"06:00"` and `"09:30"`. Postgres accepted them on insert,
so every stored row is correct — but the default is also what a fresh unsaved
instance holds, and `Route.window` formats it with `%H:%M`. A route created
without explicit times therefore raised `ValueError` the moment it was
serialised, which is to say every route created through the API without a
window returned a 500.

Column type and stored data are unchanged; this alters only what Django puts on
a new instance. Nothing to back-fill and nothing to reverse beyond the default.
"""

import datetime
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fieldops', '0007_route_stop_holding'),
    ]

    operations = [
        migrations.AlterField(
            model_name='route',
            name='window_end',
            field=models.TimeField(default=datetime.time(9, 30)),
        ),
        migrations.AlterField(
            model_name='route',
            name='window_start',
            field=models.TimeField(default=datetime.time(6, 0)),
        ),
    ]
