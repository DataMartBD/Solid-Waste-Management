"""Where the building is, above the city's own wards: district and thana.

Both blank rather than null, and neither is required. Every holding already on
record was registered without them, so a required column would mean inventing a
district for 39 buildings nobody surveyed for one — and would block editing any
of them until somebody did. They fill in as buildings are next touched.

No back-fill for the same reason: there is nothing to derive them from. Ward 09
does not imply a district in the data, only in an operator's head.

Reversible: going back drops two columns that nothing else reads.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('customers', '0007_holding_agency'),
    ]

    operations = [
        migrations.AddField(
            model_name='holding',
            name='district',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='holding',
            name='thana',
            field=models.CharField(blank=True, help_text='Thana / upazila', max_length=96),
        ),
    ]
