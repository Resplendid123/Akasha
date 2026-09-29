from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, ClassVar

from .corpus import CorpusIndex
from .models import CanonicalSample, DataDependency, SubsetStrategy


class DatasetAdapter(ABC):
    name: ClassVar[str]
    qa_filename: ClassVar[str]
    corpus_filename: ClassVar[str]
    provides: ClassVar[frozenset[DataDependency]]
    subset_strategy: ClassVar[SubsetStrategy]
    downloadable: ClassVar[bool] = True
    version: ClassVar[str] = "1"

    def has(self, dependency: DataDependency) -> bool:
        return dependency in self.provides

    def identity_rules(self) -> dict[str, str]:

        from .models import CORPUS_ID_RULES, SAMPLE_ID_RULES

        return {
            "sample_id": SAMPLE_ID_RULES[self.name],
            "corpus_doc_id": CORPUS_ID_RULES[self.name],
        }

    @abstractmethod
    def parse_row(
        self, row: dict[str, Any], row_index: int, corpus: CorpusIndex
    ) -> CanonicalSample:
        pass

    def expected_qa_rows(self) -> int | None:

        return None
