"""Which building a survey was started from, when it was started from one.

Nullable, and no back-fill. A survey taken cold at an unknown door is the normal
case — finding premises nobody has on record is what the exercise is for — and
the surveys already recorded were all taken that way, so there is nothing to
fill in. Guessing one from a matching house number would invent a link nobody
made.

Distinct from `converted_to`, which points the other way in time: this is where
the survey came from, that is what it later became.

Reversible: dropping the column loses only the reference, never a survey.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customers', '0008_holding_district_holding_thana'),
        ('surveys', '0006_question_width'),
    ]

    operations = [
        migrations.AddField(
            model_name='survey',
            name='holding',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='surveys_about', to='customers.holding'),
        ),
    ]
