import _ from "underscore";
import { t } from "ttag";

import type {
  Card,
  CollectionEssentials,
  SearchResult,
} from "metabase-types/api";
import * as Urls from "metabase/lib/urls";

import Link from "metabase/core/components/Link";
import LoadingAndErrorWrapper from "metabase/components/LoadingAndErrorWrapper";
import Search from "metabase/entities/search";

import type {
  useCollectionListQuery,
  useSearchListQuery,
} from "metabase/common/hooks";

import { Box, Group, Icon, Text, Title } from "metabase/ui";
import NoResults from "assets/img/no_results.svg";
import { useDispatch, useSelector } from "metabase/lib/redux";
import { getLocale } from "metabase/setup/selectors";
import { isInstanceAnalyticsCollection } from "metabase/collections/utils";
import { getCollectionIcon } from "metabase/entities/collections";
import type { BrowseFilters } from "../utils";
import { getCollectionName, groupModels } from "../utils";
import { CenteredEmptyState } from "./BrowseApp.styled";
import {
  CollectionHeaderContainer,
  CollectionHeaderGroup,
  CollectionHeaderLink,
  GridContainer,
  ModelCard,
  MultilineEllipsified,
} from "./BrowseModels.styled";
import { LastEdited } from "./LastEdited";
import { ModelExplanationBanner } from "./ModelExplanationBanner";
import {useEffect} from "react";

export const BrowseModels = ({
  modelsResult,
  collectionsResult,
  filters,
}: {
  modelsResult: ReturnType<typeof useSearchListQuery<SearchResult>>;
  collectionsResult: ReturnType<typeof useCollectionListQuery>;
  filters: BrowseFilters;
}) => {
  const dispatch = useDispatch();
  const models = modelsResult.data ?? [];
  const collections = collectionsResult.data ?? [];
  const locale = useSelector(getLocale);
  const localeCode: string | undefined = locale?.code;
  const error = modelsResult.error || collectionsResult.error;
  const isLoading = modelsResult.isLoading || collectionsResult.isLoading;

  // Enrich models data with collection data
  if (collections?.length) {
    models.forEach((model: SearchResult) => {
      const collection = collections.find(
        (collection: CollectionEssentials) =>
          collection.id === model.collection.id,
      );
      if (collection) {
        model.collection = collection;
      }
    });
  }

  const filteredModels = Object.values(filters).reduce(
    (acc, filter) => (filter.active ? acc.filter(filter.predicate) : acc),
    models,
  );

  useEffect(() => {
    if (error || isLoading) {
      return;
    }
    localStorage.setItem("defaultBrowseTab", "models");
  }, [error, isLoading]);

  const groupsOfModels = groupModels(filteredModels, localeCode);

  if (error || isLoading) {
    return (
      <LoadingAndErrorWrapper
        error={error}
        loading={isLoading}
        style={{ display: "flex", flex: 1 }}
      />
    );
  }

  if (filteredModels.length) {
    return (
      <>
        <ModelExplanationBanner />
        <GridContainer role="grid">
          {groupsOfModels.map(groupOfModels => (
            <ModelGroup
              models={groupOfModels}
              key={`modelgroup-${groupOfModels[0].collection.id}`}
              localeCode={localeCode}
            />
          ))}
        </GridContainer>
      </>
    );
  }

  return (
    <CenteredEmptyState
      title={<Box mb=".5rem">{t`No models here yet`}</Box>}
      message={
        <Box maw="24rem">{t`Models help curate data to make it easier to find answers to questions all in one place.`}</Box>
      }
      illustrationElement={
        <Box mb=".5rem">
          <img src={NoResults} />
        </Box>
      }
    />
  );
};

const isVerified = (model: SearchResult) =>
  model.moderated_status === "verified";

const ModelGroup = ({
  models,
  localeCode,
}: {
  models: SearchResult[];
  localeCode: string | undefined;
}) => {
  const sortedModels = models.sort((a, b) => {
    const aVerified = isVerified(a);
    const bVerified = isVerified(b);

    // Sort verified models first
    if (aVerified && !bVerified) {
      return -1;
    }
    if (!aVerified && bVerified) {
      return 1;
    }

    if (a.name && !b.name) {
      return -1;
    }
    if (!a.name && !b.name) {
      return 0;
    }
    if (!a.name && b.name) {
      return 1;
    }
    if (a.name && !b.name) {
      return -1;
    }
    if (!a.name && !b.name) {
      return 0;
    }
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return nameA.localeCompare(nameB, localeCode);
  });
  const collection = models[0].collection;

  /** This id is used by aria-labelledby */
  const collectionHtmlId = `collection-${collection.id}`;

  return (
    <>
      <CollectionHeader
        collection={collection}
        key={collectionHtmlId}
        id={collectionHtmlId}
      />
      {sortedModels.map(model => (
        <ModelCell
          model={model}
          collectionHtmlId={collectionHtmlId}
          key={`model-${model.id}`}
        />
      ))}
    </>
  );
};

interface ModelCellProps {
  model: SearchResult;
  collectionHtmlId: string;
}

// TODO: Move to separate file
const ModelCell = ({ model, collectionHtmlId }: ModelCellProps) => {
  const headingId = `heading-for-model-${model.id}`;

  const lastEditorFullName =
    model.last_editor_common_name ?? model.creator_common_name;
  const timestamp = model.last_edited_at ?? model.created_at ?? "";

  const dispatch = useDispatch();
  const wrappedModel = Search.wrapEntity(model, dispatch);
  const icon = wrappedModel.getIcon();

  return (
    <Link
      aria-labelledby={`${collectionHtmlId} ${headingId}`}
      key={model.id}
      to={Urls.model(model as unknown as Partial<Card>)}
    >
      <ModelCard>
        <Box mb="auto">
          <Icon {...icon} size={20} className="text-brand" />
        </Box>
        <Title mb=".25rem" size="1rem">
          <MultilineEllipsified tooltipMaxWidth="20rem" id={headingId}>
            {model.name}
          </MultilineEllipsified>
        </Title>
        <LastEdited editorFullName={lastEditorFullName} timestamp={timestamp} />
      </ModelCard>
    </Link>
  );
};

const CollectionHeader = ({
  collection,
  id,
}: {
  collection: CollectionEssentials;
  id: string;
}) => {
  const icon = getCollectionIcon(collection);
  return (
    <CollectionHeaderContainer
      id={id}
      role="heading"
      pt={"1rem"}
      mr="1rem"
      align="center"
    >
      <CollectionHeaderGroup grow noWrap>
        <CollectionHeaderLink to={Urls.collection(collection)}>
          <Group spacing=".25rem">
            <Icon {...icon} />
            <Text weight="bold" color="text-dark">
              {getCollectionName(collection)}
            </Text>
          </Group>
        </CollectionHeaderLink>
      </CollectionHeaderGroup>
    </CollectionHeaderContainer>
  );
};
