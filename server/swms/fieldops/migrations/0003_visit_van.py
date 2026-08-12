"""Record which vehicle served a stop.

Nullable, and deliberately not back-filled. `Van.driver` holds only the van's
*current* driver, so deriving a past visit's vehicle from its collector would
attribute old work to whoever happens to be driving today — a plausible-looking
answer that is wrong. Existing visits therefore keep `van = NULL`, which is
honest about what the data can support; new visits stamp it at recording time.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("fieldops", "0002_deferrable_route_stop_seq"),
        ("fleet", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="visit",
            name="van",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="visits",
                to="fleet.van",
            ),
        ),
    ]